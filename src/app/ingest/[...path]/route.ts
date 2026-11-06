/**
 * First-party reverse proxy for PostHog (Task 167).
 *
 * posthog-js is configured with api_host '/ingest' so capture/decide/batch
 * calls and session-replay assets ride www.hustleportal.online instead of a
 * third-party domain — ad blockers and tracking-prevention browsers don't eat
 * the events, and no cross-origin handshake is needed (CSP `connect-src
 * 'self'` already allows it).
 *
 * Inert until you flip it on: if NEXT_PUBLIC_POSTHOG_HOST is not set in the
 * environment this route answers 404 and nothing else happens. Set it in
 * Vercel → Environment Variables (e.g. https://eu.i.posthog.com) together
 * with NEXT_PUBLIC_POSTHOG_KEY and redeploy.
 */
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// Never forwarded in either direction.
const DROP_REQ = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'accept-encoding', // let undici negotiate; we strip the encoding header below
])
const DROP_RES = new Set([
  'content-encoding', // fetch() already decompressed the body
  'content-length', // length of the compressed body, now a lie
  'connection',
  'keep-alive',
  'transfer-encoding',
  'set-cookie', // hygiene: no upstream cookies land on our apex domain
])

async function proxy(req: NextRequest): Promise<Response> {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
  if (!host) return new Response('Not found', { status: 404 })

  const rest = req.nextUrl.pathname.replace(/^\/ingest\/?/, '/')
  let url: URL
  try {
    url = new URL(rest, host)
  } catch {
    return new Response('Bad gateway', { status: 502 })
  }
  url.search = req.nextUrl.search

  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (!DROP_REQ.has(key.toLowerCase())) headers.set(key, value)
  })

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    })
    const resHeaders = new Headers()
    res.headers.forEach((value, key) => {
      if (!DROP_RES.has(key.toLowerCase())) resHeaders.set(key, value)
    })
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders })
  } catch {
    return new Response('Bad gateway', { status: 502 })
  }
}

export { proxy as GET, proxy as HEAD, proxy as OPTIONS, proxy as POST, proxy as PUT }
