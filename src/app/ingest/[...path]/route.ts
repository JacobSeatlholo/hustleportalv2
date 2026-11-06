/**
 * First-party reverse proxy for PostHog (Task 167).
 *
 * posthog-js is configured with api_host '/ingest' so capture/decide/batch
 * calls and session-replay assets ride www.hustleportal.online instead of a
 * third-party domain — ad blockers and tracking-prevention browsers don't eat
 * the events, and no cross-origin handshake is needed (CSP `connect-src
 * 'self'` already allows it).
 *
 * The kill switch lives on the client: posthog-js only loads when
 * NEXT_PUBLIC_POSTHOG_KEY is set in Vercel → Environment Variables, so with
 * the key unset nothing ever posts through this route. The upstream host is
 * NEXT_PUBLIC_POSTHOG_HOST with an EU fallback (see note in the handler).
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
  // NEXT_PUBLIC_* is a BUILD-TIME prefix: it gets inlined into client bundles
  // (verified live on prod) but Vercel's standalone lambda does not reliably
  // surface it to this handler at runtime — which left the pipe 404ing even
  // with the var saved. So: use the build env when it inlines, fall back to
  // the EU upstream (the region HustlePortal's PostHog project lives in).
  // The client keeps the real kill switch: posthog-js only loads at all when
  // NEXT_PUBLIC_POSTHOG_KEY is set, so with the key unset nothing ever posts.
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

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
