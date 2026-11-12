import { NextRequest, NextResponse } from 'next/server'
import { captureInboundEmail, parseReceiptAsync } from '@/lib/mailinbound'
import { rateLimit, tooMany } from '@/lib/ratelimit'

// ============ SES INBOUND WEBHOOK (CC / BCC to log@hustleportal.online) ============
//
// Amazon SES receives mail for the capture address, its receipt rule posts a
// signed SNS notification here, and the mail lands in the sender's email log
// (see src/lib/mailinbound.ts for the laws). Boss-side setup, one time:
//   DNS:      MX 10 inbound-smtp.af-south-1.amazonaws.com on hustleportal.online
//   SES:      receipt rule for log@hustleportal.online → SNS action,
//             "Include original content" = Yes, spam/virus scan on
//   SNS:      HTTPS subscription to this URL with ?key=<the secret>
//   Vercel:   SES_INBOUND_SECRET env (falls back to SES_WEBHOOK_SECRET)
//
// Security, layered:
//  1. Shared secret (required) — without it the door does not exist (503).
//  2. Real SNS SignatureVersion-1 validation on every Notification — the
//     signature is RSA-SHA1 over SNS's canonical string, verified with the
//     public key from the certificate AWS publishes on *.amazonaws.com. A
//     forged or replayed envelope without AWS's signature is dropped.
//  3. The parse-and-store path itself is idempotent (SES messageId dedupe).

export const maxDuration = 30

function inboundSecret(): string | null {
  return process.env.SES_INBOUND_SECRET || process.env.SES_WEBHOOK_SECRET || null
}

const SNS_URL_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//

/**
 * SNS SignatureVersion 1: RSA-SHA1 over the canonical message string —
 * the present fields in this exact order, each followed by a newline:
 *   Message, MessageId, [Subject], Timestamp, TopicArn, Type
 * The signing certificate must live on an amazonaws.com SNS host (no SSRF
 * surface), and the signature must verify against its public key.
 */
async function verifySnsSignature(env: Record<string, unknown>): Promise<boolean> {
  // Local-test escape hatch only. Never set in production.
  if (process.env.SES_INBOUND_SKIP_SIG === '1') return true

  const signature = typeof env.Signature === 'string' ? env.Signature : null
  const certUrl = typeof env.SigningCertURL === 'string' ? env.SigningCertURL : null
  if (!signature || !certUrl) return false
  if (!SNS_URL_RE.test(certUrl)) return false

  const fields: string[] = [
    String(env.Message ?? ''),
    String(env.MessageId ?? ''),
  ]
  if (typeof env.Subject === 'string' && env.Subject.length) fields.push(env.Subject)
  fields.push(
    String(env.Timestamp ?? ''),
    String(env.TopicArn ?? ''),
    String(env.Type ?? ''),
  )
  const canonical = fields.map((f) => f + '\n').join('')

  try {
    const certRes = await fetch(certUrl, { signal: AbortSignal.timeout(10_000) })
    if (!certRes.ok) return false
    const certPem = await certRes.text()
    const { X509Certificate, createVerify } = await import('node:crypto')
    const cert = new X509Certificate(certPem)
    const verifier = createVerify('RSA-SHA1')
    verifier.update(canonical, 'utf8')
    return verifier.verify(cert.publicKey, signature, 'base64')
  } catch (e) {
    console.error('[ses-inbound] signature verification error', e)
    return false
  }
}

interface SesReceiptMail {
  messageId?: string
  timestamp?: string
  destination?: string[]
  source?: string
  commonHeaders?: { from?: string[]; to?: string[]; cc?: string[]; subject?: string; date?: string }
}

export async function POST(req: NextRequest) {
  const secret = inboundSecret()
  if (!secret) {
    return NextResponse.json({ error: 'Inbound capture not configured.' }, { status: 503 })
  }
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || req.headers.get('x-webhook-secret') || ''
  if (key !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const env = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!env || typeof env !== 'object' || typeof env.Type !== 'string') {
    return NextResponse.json({ error: 'Invalid envelope.' }, { status: 400 })
  }

  // SNS handshake: confirm the subscription by visiting the SubscribeURL
  // (guarded to real SNS hosts), exactly like the outbound events webhook.
  if (env.Type === 'SubscriptionConfirmation') {
    const subscribeUrl = typeof env.SubscribeURL === 'string' ? env.SubscribeURL : ''
    if (SNS_URL_RE.test(subscribeUrl)) {
      try {
        await fetch(subscribeUrl, { signal: AbortSignal.timeout(10_000) })
      } catch (e) {
        console.error('[ses-inbound] subscribe confirm fetch failed', e)
      }
    }
    return NextResponse.json({ ok: true, confirmed: true })
  }
  if (env.Type === 'UnsubscribeConfirmation') {
    return NextResponse.json({ ok: true, ignored: true })
  }
  if (env.Type !== 'Notification') {
    return NextResponse.json({ ok: true, ignored: true })
  }

  // Every Notification must carry AWS's signature — no signature, no entry.
  const sigOk = await verifySnsSignature(env)
  if (!sigOk) {
    return NextResponse.json({ error: 'Invalid SNS signature.' }, { status: 403 })
  }

  let message: Record<string, unknown>
  try {
    message = JSON.parse(String(env.Message))
  } catch {
    return NextResponse.json({ error: 'Invalid message JSON.' }, { status: 400 })
  }

  const type = String(message.notificationType || message.eventType || '')
  if (type !== 'Received') {
    // Bounce/complaint events for inbound mail would ride the same topic;
    // nothing to store for them here.
    return NextResponse.json({ ok: true, ignored: true })
  }

  const mail = (message.mail || {}) as SesReceiptMail
  const receipt = (message.receipt || {}) as { spamVerdict?: { status?: string } }
  const content = typeof message.content === 'string' ? message.content : ''

  const spam = receipt.spamVerdict?.status === 'FAIL'
  const parsed = await parseReceiptAsync({
    content,
    commonHeaders: mail.commonHeaders || null,
    destination: mail.destination || null,
    timestamp: mail.timestamp || null,
    sesMessageId: mail.messageId || null,
    spam,
  })

  try {
    const result = await captureInboundEmail(parsed)
    return NextResponse.json({ ok: true, outcome: result.outcome })
  } catch (e) {
    console.error('[ses-inbound] capture failed', e)
    // SES retries on 5xx — an honest transient failure beats a silent loss.
    return NextResponse.json({ ok: false, error: 'capture failed' }, { status: 500 })
  }
}

export async function GET() {
  // A plain-language readiness probe for setup day.
  const secret = inboundSecret()
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'Inbound capture not configured (set SES_INBOUND_SECRET).' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, capture: 'ready', address: 'log@hustleportal.online' })
}
