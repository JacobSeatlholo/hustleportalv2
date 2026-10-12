#!/usr/bin/env node
/**
 * Diagnose v2 — isolate the PLATFORM Gemini key from site-fetch starvation.
 * Register → fill workspace profile → probe sales-pitch (pure generateContent,
 * zero site fetch, full 30s budget) → probe discover (search-grounded lead-gen).
 */
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const EMAIL = `diag2_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaTest2026!'
let cookie = ''

async function req(method, path, body, timeoutMs = 90000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const setC = res.headers.get('set-cookie')
    if (setC) cookie = setC.split(';')[0]
    let json = null
    try { json = await res.json() } catch {}
    return { status: res.status, json, ms: Date.now() - t0 }
  } catch (e) {
    return { status: 0, json: { error: e.message }, ms: Date.now() - t0 }
  } finally { clearTimeout(t) }
}

async function main() {
  console.log(`AI diagnostic v2 vs ${BASE} — ${EMAIL}`)
  const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'Diag Bot', businessName: 'Diag Spaza', industry: 'RETAIL', city: 'Johannesburg' })
  console.log(`register: ${reg.status} (${reg.ms}ms) ok=${reg.json?.ok === true}`)

  // Fill the workspace profile so the pitch guard passes
  const projs = await req('GET', '/api/projects')
  const pid = projs.json?.projects?.[0]?.id || projs.json?.[0]?.id
  console.log(`projects: ${projs.status} pid=${pid}`)
  const patch = await req('PATCH', `/api/projects/${pid}`, {
    offerings: 'Fresh takeaway meals, catering platters and office lunch delivery',
    valueProp: 'Home-cooked taste at spaza prices, delivered to your door in Sandton within the hour',
    targetMarket: 'Office workers and small businesses in Sandton, Johannesburg',
  })
  console.log(`profile patch: ${patch.status} (${patch.ms}ms)`)

  // PROBE A — pure generateContent on the platform key
  const p = await req('POST', '/api/ai/sales-pitch', {})
  console.log(`\n[A] sales-pitch ${p.status} (${(p.ms/1000).toFixed(1)}s)`)
  if (p.json?.pitch) console.log('    PLATFORM KEY HEALTHY:', JSON.stringify(p.json.pitch.slice(0, 100)))
  else console.log('    ERROR:', JSON.stringify(p.json?.error || p.json))

  // PROBE B — discover (search-grounded) — the user's lead-gen path
  const d = await req('POST', '/api/leads/discover', { definition: 'offices that order catering weekly', city: 'Sandton, Johannesburg', limit: 3 })
  console.log(`\n[B] discover ${d.status} (${(d.ms/1000).toFixed(1)}s)`)
  if (d.json?.leads) console.log('    DISCOVER OK:', d.json.leads.length, 'leads; first:', JSON.stringify(d.json.leads[0]?.company))
  else console.log('    ERROR:', JSON.stringify(d.json?.error || d.json).slice(0, 400))
}
main().catch((e) => { console.error('diag crashed:', e.message); process.exit(1) })
