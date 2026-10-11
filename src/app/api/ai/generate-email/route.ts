import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserId } from '@/lib/auth'
import { resolveProject, profileText } from '@/lib/workspace'
import { geminiGenerate } from '@/lib/gemini'

export const maxDuration = 60

// POST /api/ai/generate-email { leadId?, clientName?, goal?, toneOverride? } → draft + EmailLog
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  try {
    const parsed = JSON.parse(result.text.replace(/```json|```/g, '').trim()) as { subject?: string; body?: string }
    if (parsed.subject) subject = parsed.subject
    if (parsed.body) emailBody = parsed.body
  } catch {
    // fall through with raw text as body
  }

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
  return NextResponse.json({ draft: { id: log.id, subject, body: emailBody, toEmail, leadId, projectId: project.id } })
}
