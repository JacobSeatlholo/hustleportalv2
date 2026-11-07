import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

export const maxDuration = 60

/**
 * ONE-TIME DOOR — Task 175 discovery proxy (Task 146 precedent). The sandbox
 * cannot reach Overpass (proxy block); prod can. This door takes Overpass QL
 * text and returns the raw public ODbL elements — nothing else. Guardrails:
 *   - token-gated (wrong token = 404),
 *   - ONLY https://overpass-api.de/api/interpreter is ever fetched,
 *   - queries must start with "[out:json]" and stay under 3000 chars,
 *   - sequential fetches inside one 55s budget, leftover queries echoed back
 *     so the caller can re-POST them in a follow-up call,
 *   - no PII, no platform data, no writes, no sends.
 * Deleted right after discovery completes.
 */

const DOOR_TOKEN = '05b965c45e88946644c256f91703554d'
const ENDPOINT = 'https://overpass-api.de/api/interpreter'

function tokenOk(got: string | null): boolean {
  if (!got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(DOOR_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!tokenOk(url.searchParams.get('token'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { queries?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const queries = (body.queries || []).filter(
    (q) => typeof q === 'string' && q.trim().startsWith('[out:json]') && q.length < 3000
  )
  if (queries.length === 0) {
    return NextResponse.json({ error: 'No valid Overpass queries.' }, { status: 400 })
  }

  const deadline = Date.now() + 55_000
  const results: { ql: string; elements: unknown[]; error?: string }[] = []
  const leftover: string[] = []

  for (const q of queries) {
    if (Date.now() > deadline) { leftover.push(q); continue }
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HustlePortalBot/1.0 (lead discovery)' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(50_000),
      })
      if (!r.ok) {
        results.push({ ql: q.slice(0, 120), elements: [], error: `overpass HTTP ${r.status}` })
        continue
      }
      const data = await r.json()
      results.push({ ql: q.slice(0, 120), elements: data.elements || [] })
    } catch (e) {
      results.push({ ql: q.slice(0, 120), elements: [], error: String(e).slice(0, 120) })
    }
  }

  return NextResponse.json({ ok: true, results, leftover })
}
