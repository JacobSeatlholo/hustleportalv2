import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { resolveProject } from '@/lib/workspace'
import { db } from '@/lib/db'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'
import { safeUrl } from '@/lib/ssrf'

export const maxDuration = 60

/**
 * POST /api/ai/business-url { url, projectId? }
 *
 * The user drops in their business URL; HustlePortal fetches the page, strips it
 * to readable text and has Gemini dissect it into:
 *   - audience (who buys, what pains them)
 *   - brand (voice, personality)
 *   - positioning (one professional paragraph)
 *   - three ready-to-send sales pitches (cold intro, follow-up, upsell)
 *   - keywords worth owning
 * The full analysis is saved on the workspace (Project.audienceInsight) so every
 * later AI draft, pitches, emails, plans, grounds on it automatically.
 */

const MAX_HTML_BYTES = 3 * 1024 * 1024
const MAX_TEXT_CHARS = 14_000

async function normalizeUrl(raw: string): Promise<string | null> {
  // Hardened: syntactic checks PLUS a DNS resolve whose every answer must be
  // public, string blocklists alone miss octal IPs, IPv6 loopback and DNS
  // that points at private/link-local space (cloud metadata included).
  const verdict = await safeUrl(raw)
  return verdict.ok ? verdict.url! : null
}

function isDnsFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const name = (e as Error & { name?: string }).name || ''
  if (name === 'TimeoutError') return false
  const code = (e as Error & { cause?: { code?: string } }).cause?.code || ''
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET/i.test(code) || /fetch failed/i.test(e.message)
}

/**
 * South African addresses are routinely mistyped: "mybusiness.co.za" typed as
 * "mybusinessco.za" (the dot before "co" vanishes) or the www left off an apex
 * that only answers on www. Instead of bouncing the user with "could not reach
 * that website", we probe the most likely corrected forms of their address and
 * read the first one that answers. The caller is told whenever a correction was
 * applied so the user can save the right address on their profile.
 */
function domainCandidates(hostname: string): string[] {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  const labels = host.split('.')
  const out: string[] = []
  if (labels.length >= 2) {
    const base = labels.slice(0, -1).join('.')
    const tld = labels[labels.length - 1]
    const singleLabel = !base.includes('.')
    // "businesshustleco.za" -> base "businesshustleco", tld "za"
    if (tld === 'za' && singleLabel && base.endsWith('co') && base.length > 4) {
      out.push(`${base.slice(0, -2)}.co.za`)
    }
    if (tld === 'za' && singleLabel && base.length > 2) {
      out.push(`${base}.co.za`)
    }
    if (tld === 'co.za' && !host.startsWith('www.')) {
      out.push(`www.${host}`)
    }
    if (!host.startsWith('www.')) out.push(`www.${host}`)
    if (host.startsWith('www.')) out.push(host)
  }
  return [...new Set(out)].filter((c) => c !== hostname.toLowerCase())
}

async function probeReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HustlePortalBot/1.0; +https://hustleportal.online)', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6_000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function fetchPage(url: string): Promise<{ text: string; html: string; finalUrl: string } | { error: string; dns?: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HustlePortalBot/1.0; +https://hustleportal.online)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-ZA,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return { error: `That site responded with HTTP ${res.status}. Check the address, or paste the business info manually and use Generate instead.` }
    }
    const html = (await res.text()).slice(0, MAX_HTML_BYTES)
    return { text: htmlToText(html).slice(0, MAX_TEXT_CHARS), html, finalUrl: res.url || url }
  } catch (e) {
    if (isDnsFailure(e)) return { error: 'We could not find that web address on the internet (it may be misspelled).', dns: true }
    return { error: 'That website took too long to respond (it may be offline or very slow). Try again in a moment.' }
  }
}

function metaContent(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return ''
}

/**
 * The no-AI floor: read the site's own meta tags and contact links directly.
 * When the AI minute is rate-limited, this still fills the profile with facts
 * the site itself states, name, tagline, contact email, phone. Nothing is
 * invented; whatever the site does not say stays empty.
 */
function extractFromHtml(html: string, text: string, finalUrl: string): BusinessAnalysis {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim()
  const siteName = metaContent(html, 'og:site_name')
  const description = metaContent(html, 'description') || metaContent(html, 'og:description')
  const businessName = siteName || (title ? title.split(/[|–—·::]/)[0].trim() : '')
  const tagline = description.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || ''

  const host = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, '') } catch { return '' } })()
  const emails = [...text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)]
    .map((m) => m[0].toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e))
  const email = emails.find((e) => host && e.endsWith(`@${host}`)) || emails[0] || undefined

  const telMatch = html.match(/href=["']tel:([^"']+)["']/i)?.[1] || text.match(/(?:\+27|0)\s?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}/)?.[0]
  let phone: string | undefined
  if (telMatch) {
    const digits = telMatch.replace(/[^\d+]/g, '')
    phone = digits.startsWith('0') ? `+27${digits.slice(1)}` : digits
  }

  return {
    businessName: businessName || undefined,
    tagline: tagline || undefined,
    email,
    phone,
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
}

export interface BusinessAnalysis {
  businessName?: string
  industry?: string
  tagline?: string
  city?: string
  phone?: string
  email?: string
  audience?: { summary?: string; demographics?: string; painPoints?: string[] }
  brand?: { voice?: string; personality?: string[] }
  positioning?: string
  pitches?: { type?: string; subject?: string; body?: string }[]
  keywords?: string[]
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // AI cost guard: one daily allowance per account, checked BEFORE any
  // Gemini/DeepSeek spend. Generous for humans, a wall for scripts.
  const budget = await consumeAiBudget(userId)
  if (!budget.ok) {
    return NextResponse.json(aiBudgetExceeded(budget), { status: 429 })
  }
  const body = await req.json().catch(() => ({}))
  const url = await normalizeUrl(String(body.url || ''))
  if (!url) {
    return NextResponse.json({ error: 'Enter a valid business web address, e.g. bloombeauty.co.za' }, { status: 400 })
  }
  const project = await resolveProject(userId, body.projectId)

  const notices: string[] = []
  const routeDeadline = Date.now() + 55_000

  // 1) Fetch the page. When the address does not resolve, probe the likely
  //    corrected forms ("businesshustleco.za" really means "businesshustle.co.za")
  //    and read the one that answers, telling the user what we did.
  let page = await fetchPage(url)
  if ('error' in page && page.dns) {
    const candidates = domainCandidates(new URL(url).hostname).slice(0, 2)
    for (const c of candidates) {
      const candidateUrl = `https://${c}/`
      const safeCandidate = await safeUrl(candidateUrl)
      if (!safeCandidate.ok) continue
      if (!(await probeReachable(safeCandidate.url!))) continue
      const rescued = await fetchPage(safeCandidate.url!)
      if ('text' in rescued) {
        page = rescued
        notices.push(`We could not find ${new URL(url).hostname}, so we read ${new URL(rescued.finalUrl).hostname} instead. That is the address worth saving on your profile.`)
        break
      }
    }
  }
  if ('error' in page) {
    const hint = page.dns && domainCandidates(new URL(url).hostname).length
      ? ' Double check the spelling. South African sites usually end in .co.za, for example businesshustle.co.za.'
      : ''
    return NextResponse.json({ error: `${page.error}${hint}` }, { status: 400 })
  }
  const pageText = page.text
  const pageHtml = page.html
  const finalUrl = page.finalUrl
  if (pageText.replace(/\s/g, '').length < 200) {
    return NextResponse.json(
      { error: 'That page has too little text to analyse. Try the homepage, or fill the workspace profile manually.' },
      { status: 400 }
    )
  }

  // 2) Gemini dissection, grounded ONLY in the page text, shaped for reality:
  //    the profile fields the user actually needs are a SMALL, FAST output, so
  //    they go first and land even on a slow free-tier minute. The pitch drafts
  //    are a big payload that can outlive any sane timeout, so they run second,
  //    only when the clock allows, a bonus, never the difference between a
  //    filled profile and a dead end.
  const system =
    'You are a meticulous South African market analyst and direct-response copywriter. You research a business from its website text and produce precise, professional output. Never invent facts that are not supported by the text. When the text is thin, say less rather than guess. Write pitches in plain, confident English for WhatsApp and SMS length emails (South African small-business tone: warm, direct, no hype, no emojis).'
  const compact = await geminiGenerate(userId, {
    json: true,
    system,
    maxOutputTokens: 900,
    timeoutMs: 28_000,
    prompt: `=== WEBSITE TEXT (${finalUrl}) ===\n${pageText.slice(0, 8000)}\n\n=== TASK ===\nReturn ONLY this JSON with the business profile facts visible on the page (omit a field rather than inventing it):\n{ "businessName": "", "industry": "", "tagline": "", "city": "", "phone": "", "email": "", "audience": { "summary": "who buys from them, 1-2 sentences" }, "brand": { "voice": "how the brand talks, 1 sentence" }, "positioning": "what they sell, to whom, and why it wins, 2-3 sentences", "keywords": ["5 search terms real customers would type"] }`,
  })

  let analysis: BusinessAnalysis | null = compact.ok ? parseJsonLoose<BusinessAnalysis>(compact.text) : null
  let geminiNotice = compact.ok ? compact.notice : undefined
  let degraded = false

  const usable = (a: BusinessAnalysis | null): boolean =>
    !!a && !!(a.positioning || a.businessName || a.tagline)

  if (analysis && usable(analysis)) {
    // Enrichment pass: pitch drafts + deeper audience reading, best-effort.
    const profile = analysis
    const remaining = routeDeadline - Date.now()
    if (remaining > 15_000) {
      const enrich = await geminiGenerate(userId, {
        json: true,
        system,
        maxOutputTokens: 1600,
        timeoutMs: Math.min(remaining - 2_000, 24_000),
        prompt: `=== WEBSITE TEXT (${finalUrl}) ===\n${pageText.slice(0, 9000)}\n\n=== BUSINESS ===\n${profile.businessName || ''} · ${profile.industry || ''} · ${profile.positioning || ''}\n\n=== TASK ===\nReturn ONLY this JSON:\n{ "audience": { "summary": "who actually buys, 2 sentences max", "demographics": "location/income/device realities, 1 sentence", "painPoints": ["3-5 short buyer pain points"] }, "brand": { "voice": "how the brand talks, 1 sentence", "personality": ["3-5 adjectives"] }, "pitches": [ { "type": "cold intro", "subject": "email subject under 45 chars", "body": "60-90 word email with a clear call to action" }, { "type": "follow-up", "subject": "email subject under 45 chars", "body": "40-70 word polite follow-up" }, { "type": "upsell", "subject": "email subject under 45 chars", "body": "50-80 word upsell for existing clients" } ] }`,
      })
      if (enrich.ok) {
        const extra = parseJsonLoose<BusinessAnalysis>(enrich.text)
        if (extra && analysis) {
          analysis = {
            ...analysis,
            audience: extra.audience?.summary ? extra.audience : analysis.audience,
            brand: extra.brand?.voice ? extra.brand : analysis.brand,
            pitches: Array.isArray(extra.pitches) && extra.pitches.length ? extra.pitches : analysis.pitches,
          }
          if (enrich.notice) geminiNotice = geminiNotice ? `${geminiNotice} ${enrich.notice}` : enrich.notice
        }
      }
    } else {
      degraded = true
    }
  } else {
    // The AI minute was busy (quota, rotation, or a hiccup): the profile still
    // fills from the site's own meta tags and contact links. Facts only.
    const facts = extractFromHtml(pageHtml, pageText, finalUrl)
    if (facts.businessName || facts.tagline || facts.email || facts.phone) {
      analysis = { ...(analysis || {}), ...facts }
      degraded = true
      notices.push('The AI minute was busy, so we read your website directly and saved the facts we could confirm: name, tagline and contact details. Run Generate again soon for the full positioning and pitch drafts.')
    }
  }

  if (!usable(analysis)) {
    const err = compact.ok
      ? 'The AI could not read enough from that page. Try the homepage address, or fill the workspace profile manually.'
      : compact.error
    // Even on AI failure, the user must keep what we learned (e.g. the corrected address).
    return NextResponse.json(
      { error: err, ...(notices.length ? { notice: notices.join(' ') } : {}) },
      { status: err.startsWith('NO_KEY') ? 503 : 400 }
    )
  }
  if (degraded) {
    notices.push('We saved the core profile from your site. The three ready made pitch drafts will appear when you run Generate again with a steadier connection.')
  }

  // 3) Persist to the workspace so every later AI draft grounds on it
  const insight = JSON.stringify({ ...analysis, sourceUrl: finalUrl, analyzedAt: new Date().toISOString() })
  const updated = await db.project.update({
    where: { id: project.id },
    data: { audienceInsight: insight },
  })

  const allNotices = [...(geminiNotice ? [geminiNotice] : []), ...notices]
  return NextResponse.json({ ok: true, analysis, project: updated, ...(allNotices.length ? { notice: allNotices.join(' ') } : {}) })
}

// GET → last saved analysis for the active workspace
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId')
  const project = await resolveProject(userId, projectId)
  if (!project.audienceInsight) return NextResponse.json({ ok: true, analysis: null })
  try {
    const parsed = JSON.parse(project.audienceInsight) as BusinessAnalysis & { sourceUrl?: string; analyzedAt?: string }
    return NextResponse.json({ ok: true, analysis: parsed })
  } catch {
    return NextResponse.json({ ok: true, analysis: null })
  }
}
