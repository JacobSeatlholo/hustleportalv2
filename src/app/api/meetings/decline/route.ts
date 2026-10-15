import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendSystemMail, TEAM_INBOX } from '@/lib/mailer'
import { declinedEmail, invalidTokenPage, declinedPage, HTML_HEADERS } from '@/lib/meeting'

export const dynamic = 'force-dynamic'

// POST /api/meetings/decline — the honest second option on the confirm page.
// Nothing gets cancelled behind anyone's back: the team gets a note and will
// offer fresh times.
export async function POST(req: NextRequest) {
  let token = ''
  try {
    const form = await req.formData()
    token = String(form.get('token') || '').trim()
  } catch {
    token = new URL(req.url).searchParams.get('token')?.trim() || ''
  }
  if (!token) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  const meeting = await db.meeting.findUnique({ where: { confirmToken: token } })
  if (!meeting) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  if (meeting.status === 'DECLINED') {
    return new NextResponse(declinedPage(meeting), { headers: HTML_HEADERS })
  }
  if (meeting.status !== 'PROPOSED') {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }

  await db.meeting.update({
    where: { id: meeting.id },
    data: { status: 'DECLINED' },
  })
  const note = declinedEmail(meeting)
  await sendSystemMail({ to: TEAM_INBOX, ...note }).catch(() => {})

  console.log(`[meetings] declined: ${meeting.memberName} (${meeting.memberEmail}) — ${meeting.title}`)

  return new NextResponse(declinedPage(meeting), { headers: HTML_HEADERS })
}
