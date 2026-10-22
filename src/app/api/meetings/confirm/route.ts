import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  confirmPage,
  confirmedPage,
  alreadyConfirmedPage,
  invalidTokenPage,
  HTML_HEADERS,
} from '@/lib/meeting'
import { confirmAndNotify } from '@/lib/meetingConfirm'

export const dynamic = 'force-dynamic'

// GET /api/meetings/confirm?token=…, the page the invite email opens.
// Side effect free: the actual confirm is a form POST, so email scanners that
// prefetch links can never confirm anything by accident.
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')?.trim() || ''
  if (!token) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  const meeting = await db.meeting.findUnique({ where: { confirmToken: token } })
  if (!meeting) return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  if (meeting.status === 'CONFIRMED') {
    return new NextResponse(alreadyConfirmedPage(meeting), { headers: HTML_HEADERS })
  }
  if (meeting.status !== 'PROPOSED') {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }
  return new NextResponse(confirmPage(meeting), { headers: HTML_HEADERS })
}

// POST /api/meetings/confirm, the one tap lands here. Confirms the meeting,
// emails BOTH parties the final details, and drops a note to the team inbox.
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
  if (meeting.status === 'CONFIRMED') {
    return new NextResponse(alreadyConfirmedPage(meeting), { headers: HTML_HEADERS })
  }
  if (meeting.status !== 'PROPOSED') {
    return new NextResponse(invalidTokenPage(), { headers: HTML_HEADERS })
  }

  // Final details to BOTH parties, via the shared confirm engine.
  await confirmAndNotify(meeting)

  return new NextResponse(confirmedPage(meeting), { headers: HTML_HEADERS })
}
