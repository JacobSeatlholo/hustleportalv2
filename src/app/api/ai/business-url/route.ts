import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { resolveProject } from '@/lib/workspace'
import { db } from '@/lib/db'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'

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
 * later AI draft — pitches, emails, plans — grounds on it automatically.
 */

const MAX_HTML_BYTES = 3 * 1024 * 1024
const MAX_TEXT_CHARS = 14_000

function normalizeUrl(raw: string): string | null {
  let v = raw.trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  try {
    const u = new URL(v)
    if (!/^https?:$/.test(u.protocol)) return null
    if (!u.hostname.includes('.')) return null
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)) return null
    return u.toString()
  } catch {
    return null
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
  audience?: { summary?: string; demographics?: string; painPoints?: string[] }
  brand?: { voice?: string; personality?: string[] }
  positioning?: string
  pitches?: { type?: string; subject?: string; body?: string }[]
  keywords?: string[]
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const url = normalizeUrl(String(body.url || ''))
  if (!url) {
    return NextResponse.json({ error: 'Enter a valid business web address, e.g. bloombeauty.co.za' }, { status: 400 })
  }
  const project = await resolveProject(userId, body.projectId)

  // 1) Fetch the page (browser-like headers; many SA small-business sites need them)
  let pageText = ''
  let finalUrl = url
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
    finalUrl = res.url || url
    if (!res.ok) {
      return NextResponse.json(
        { error: `That site responded with HTTP ${res.status}. Check the address — or paste the business info manually and use "Generate" instead.` },
        { status: 400 }
      )
    }
    const html = (await res.text()).slice(0, MAX_HTML_BYTES)
    pageText = htmlToText(html).slice(0, MAX_TEXT_CHARS)
  } catch {
    return NextResponse.json(
      { error: 'Could not reach that website (timeout or offline). Check the address and try again.' },
      { status: 400 }
    )
  }
  if (pageText.replace(/\s/g, '').length < 200) {
    return NextResponse.json(
      { error: 'That page has too little text to analyse. Try the homepage, or fill the workspace profile manually.' },
      { status: 400 }
    )
  }

  // 2) Gemini dissection — grounded ONLY in the page text
  const result = await geminiGenerate(userId, {
    json: true,
    system:
      'You are a meticulous South African market analyst and direct-response copywriter. You research a business from its website text and produce precise, professional output — never invent facts that are not supported by the text. When the text is thin, say less rather than guess. Write pitches in plain, confident English for WhatsApp/SMS-length emails (South African small-business tone: warm, direct, no hype, no emojis).',
    prompt: `=== WEBSITE TEXT (${finalUrl}) ===\n${pageText}\n\n=== TASK ===\nDissect this business for its owner. Return ONLY this JSON (omit a field rather than inventing it):\n{
  "businessName": "name as shown on the site",
  "industry": "one label",
  "audience": { "summary": "who actually buys from them, 2 sentences max", "demographics": "location/income/device realities, 1 sentence", "painPoints": ["3-5 short buyer pain points"] },
  "brand": { "voice": "how the brand talks, 1 sentence", "personality": ["3-5 adjectives"] },
  "positioning": "one professional paragraph: what they sell, to whom, and why it wins",
  "pitches": [
    { "type": "cold intro", "subject": "email subject under 45 chars", "body": "60-90 word email with a clear call to action" },
    { "type": "follow-up", "subject": "email subject under 45 chars", "body": "40-70 word polite follow-up" },
    { "type": "upsell", "subject": "email subject under 45 chars", "body": "50-80 word upsell for existing clients" }
  ],
  "keywords": ["5-8 search terms real customers would type"]
}`,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error.startsWith('NO_KEY') ? 503 : 400 })
  }

  const analysis = parseJsonLoose<BusinessAnalysis>(result.text)
  if (!analysis || !analysis.audience || !analysis.positioning) {
    return NextResponse.json(
      { error: 'The AI could not read enough from that page. Try the homepage URL, or fill the workspace profile manually.' },
      { status: 400 }
    )
  }

  // 3) Persist to the workspace so every later AI draft grounds on it
  const insight = JSON.stringify({ ...analysis, sourceUrl: finalUrl, analyzedAt: new Date().toISOString() })
  const updated = await db.project.update({
    where: { id: project.id },
    data: { audienceInsight: insight },
  })

  return NextResponse.json({ ok: true, analysis, project: updated })
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
