import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { consumeAiBudget, aiBudgetExceeded } from '@/lib/aiusage'
import { resolveProject, profileText } from '@/lib/workspace'
import { geminiGenerate, parseJsonLoose } from '@/lib/gemini'

/** Escape real control characters that appear INSIDE string literals (common Gemini breakage). */
function escapeBreaksInStrings(s: string): string | null {
  let out = ''
  let inStr = false
  let esc = false
  for (const ch of s) {
    if (esc) { out += ch; esc = false; continue }
    if (ch === '\\' && inStr) { out += ch; esc = true; continue }
    if (ch === '"') { inStr = !inStr; out += ch; continue }
    if (inStr && ch === '\n') { out += '\\n'; continue }
    if (inStr && ch === '\r') { out += '\\r'; continue }
    if (inStr && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out === s ? null : out
}

/**
 * Robust {subject, body} extraction — Gemini occasionally wraps the JSON in
 * prose, emits real newlines inside strings, or drops an escape. Never let raw
 * JSON land in the user's composer.
 */
export function extractDraftJson(text: string): { subject?: string; body?: string } | null {
  const t = text.replace(/```json|```/g, '').trim()
  // 1) strict parse
  try {
    const p = JSON.parse(t) as { subject?: string; body?: string }
    if (p && (p.subject || p.body)) return p
  } catch {}
  // 2) loose parse (tolerates prose/fences around the object)
  const loose = parseJsonLoose<{ subject?: string; body?: string }>(t)
  if (loose && (loose.subject || loose.body)) return loose
  // 3) repair: escape real newlines/tabs inside string literals, re-parse
  const repaired = escapeBreaksInStrings(t)
  if (repaired) {
    try {
      const p = JSON.parse(repaired) as { subject?: string; body?: string }
      if (p && (p.subject || p.body)) return p
    } catch {}
  }
  // 4) regex field extraction (survives unescaped quotes inside body)
  const m = t.match(/"subject"\s*:\s*"([\s\S]*?)"\s*,\s*(?:"body"|"emailBody")\s*:\s*"([\s\S]*?)"\s*\}?\s*$/)
  if (m) {
    return {
      subject: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      body: m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    }
  }
  return null
}

export const maxDuration = 60

// POST /api/ai/generate-email { leadId?, clientName?, goal?, toneOverride? } → draft + EmailLog
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
  const goal = String(body.goal || 'introduce my business and book a call').trim()

  // Resolve the business context (active workspace) + optional lead context
  const project = await resolveProject(userId, body.projectId)
  let leadContext = ''
  let toEmail = ''
  let clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  let leadId: string | null = null
  if (body.leadId) {
    const lead = await db.lead.findFirst({ where: { id: body.leadId, userId } })
    if (lead) {
      leadId = lead.id
      clientName = clientName || lead.contactName || lead.company
      toEmail = lead.email || ''
      leadContext = [
        `Prospect company: ${lead.company}`,
        lead.contactName ? `Contact: ${lead.contactName}` : null,
        lead.industry ? `Their industry: ${lead.industry}` : null,
        lead.city ? `Their city: ${lead.city}` : null,
        lead.stage ? `Pipeline stage: ${lead.stage}` : null,
        lead.notes ? `Notes: ${lead.notes}` : null,
      ].filter(Boolean).join('\n')
    }
  }
  if (body.to) toEmail = String(body.to)

  const result = await geminiGenerate(userId, {
    system:
      'You write cold/outreach emails for a South African small business. Ground every claim in the business profile below — never invent products or prices. ' +
      'Style: warm, direct, no corporate fluff, South African English. 120–180 words max. ' +
      'Return ONLY JSON: { "subject": string, "body": string } where body is plain text with \\n line breaks and a sign-off from the owner.',
    prompt: [
      `=== BUSINESS PROFILE ===\n${profileText(project)}`,
      leadContext ? `\n=== PROSPECT ===\n${leadContext}` : '',
      `\n=== TASK ===\nWrite an outreach email. Goal: ${goal}.`,
      project.tone ? `Tone: ${project.tone}.` : '',
    ].filter(Boolean).join('\n'),
    json: true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  let subject = 'Hello from ' + project.name
  let emailBody = result.text
  let parsed = extractDraftJson(result.text)
  if (!parsed) {
    // One self-repair round: ask the model to re-emit its own output as valid JSON.
    const retry = await geminiGenerate(userId, {
      system:
        'You repair broken AI drafts. Return ONLY valid JSON: { "subject": string, "body": string }. Preserve the original wording and all \\n line breaks — change nothing except JSON validity. No markdown, no commentary.',
      prompt: `The following text was meant to be JSON with a "subject" and a "body" but is malformed. Repair it and return ONLY the corrected JSON:\n\n${result.text.slice(0, 2400)}`,
      json: true,
    })
    if (retry.ok) parsed = extractDraftJson(retry.text)
  }
  if (parsed?.subject) subject = parsed.subject
  if (parsed?.body) emailBody = parsed.body

  const log = await db.emailLog.create({
    data: {
      userId,
      projectId: project.id,
      leadId,
      toEmail: toEmail || clientName || 'unknown',
      subject,
      body: emailBody,
      status: 'DRAFT',
    },
  })
  return NextResponse.json({ draft: { id: log.id, subject, body: emailBody, toEmail, leadId, projectId: project.id }, ...(result.notice ? { notice: result.notice } : {}) })
}
