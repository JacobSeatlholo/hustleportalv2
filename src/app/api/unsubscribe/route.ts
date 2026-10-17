import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyUnsubscribe } from '@/lib/campaignqueue'

/**
 * One tap out of campaign mail. RFC 8058 one click (the mail client POSTs)
 * and a plain human link (GET) land here. The address joins the suppression
 * list — the queue engine refuses it from every future send, no exceptions.
 * POPIA manners: the exit is instant, permanent and explained in plain words.
 */
async function handler(req: NextRequest, method: 'GET' | 'POST') {
  const logId = req.nextUrl.searchParams.get('c') || ''
  const sig = req.nextUrl.searchParams.get('s') || ''

  if (!logId || !sig || !(await verifyUnsubscribe(logId, sig))) {
    if (method === 'POST') return NextResponse.json({ ok: false, error: 'Invalid link.' }, { status: 400 })
    return new NextResponse(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not valid</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937"><div style="max-width:420px;text-align:center;padding:32px"><h1 style="font-size:20px">This link is not valid</h1><p style="font-size:14px;line-height:1.6;color:#5f6b7a">The unsubscribe link looks broken or expired. Reply to the email instead and say the word unsubscribe — a human will take you off the list.</p></div></body></html>`,
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const log = await db.emailLog.findUnique({
    where: { id: logId },
    select: { id: true, toEmail: true, campaign: true },
  })
  if (log) {
    await db.suppression.upsert({
      where: { email: log.toEmail },
      update: { reason: 'UNSUB', note: log.campaign || undefined },
      create: { email: log.toEmail, reason: 'UNSUB', note: log.campaign || undefined },
    })
  }

  if (method === 'POST') return NextResponse.json({ ok: true, unsubscribed: Boolean(log) })

  const email = log?.toEmail || ''
  const masked = email ? `${email.slice(0, 2)}${'*'.repeat(Math.max(1, email.indexOf('@') - 2))}${email.slice(email.indexOf('@'))}` : 'your address'
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>You are out</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937"><div style="max-width:440px;text-align:center;background:#ffffff;border:1px solid #e3e5e8;border-radius:12px;padding:40px 32px;margin:24px"><div style="width:52px;height:52px;border-radius:50%;background:#e6f4ea;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#188038" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div><h1 style="font-size:20px;margin:0 0 8px">You are out. Done.</h1><p style="font-size:14px;line-height:1.6;color:#5f6b7a;margin:0 0 4px"><b>${masked}</b> will not receive campaign email from HustlePortal again.</p><p style="font-size:13px;line-height:1.6;color:#8a94a3;margin:12px 0 0">One tap, instant, permanent. If you ever change your mind, a fresh email from us will carry a subscribe link.</p></div></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

export async function GET(req: NextRequest) {
  return handler(req, 'GET')
}

export async function POST(req: NextRequest) {
  return handler(req, 'POST')
}
