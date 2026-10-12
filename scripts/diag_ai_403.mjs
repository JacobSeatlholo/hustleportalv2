#!/usr/bin/env node
/**
 * Diagnose the 403 "Google blocked the AI request" report (2026-10-12).
 * Registers a THROWAWAY account (no personal Gemini key in Integrations) and
 * calls two AI routes. The error text fingerprints the platform-key health:
 *  - pitch OK            → platform key healthy; user's own key was the sole culprit
 *  - PERMISSION (403)    → platform key ALSO blocked → operator must fix Vercel GEMINI_API_KEY
 *  - NO_KEY (503)        → GEMINI_API_KEY missing in Vercel env
 */
const BASE = process.argv[2] || 'https://www.hustleportal.online'
const EMAIL = `diag_${Date.now()}@hustleqa.example.com`
const PASSWORD = 'QaTest2026!'
let cookie = ''

async function req(method, path, body, timeoutMs = 75000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
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
    return { status: res.status, json }
  } finally { clearTimeout(t) }
}

async function main() {
  console.log(`AI 403 diagnostic vs ${BASE} — ${EMAIL}`)
  const reg = await req('POST', '/api/auth', { action: 'register', email: EMAIL, password: PASSWORD, name: 'Diag Bot', businessName: 'Diag Spaza', industry: 'RETAIL', city: 'Johannesburg' })
  console.log(`register: ${reg.status} ok=${reg.json?.ok === true}`)
  if (reg.status !== 200) { console.log('ABORT — cannot register'); process.exit(1) }

  // Probe 1: sales pitch (plain generateContent, no search tool, no site fetch)
  const t1 = Date.now()
  const pitch = await req('POST', '/api/ai/sales-pitch', {})
  console.log(`\n[1] sales-pitch in ${((Date.now()-t1)/1000).toFixed(1)}s → ${pitch.status}`)
  if (pitch.json?.pitch) {
    console.log('    PLATFORM KEY HEALTHY — pitch preview:', JSON.stringify(pitch.json.pitch.slice(0, 120)))
  } else {
    console.log('    ERROR:', JSON.stringify(pitch.json?.error || pitch.json))
  }

  // Probe 2: website analysis (the exact flow the user reported)
  const t2 = Date.now()
  const site = await req('POST', '/api/ai/business-url', { url: 'www.businesshustle.co.za' })
  console.log(`\n[2] business-url in ${((Date.now()-t2)/1000).toFixed(1)}s → ${site.status}`)
  if (site.json?.analysis) {
    console.log('    ANALYSIS OK — industry:', JSON.stringify(site.json.analysis.industry), 'positioning:', JSON.stringify((site.json.analysis.positioning||'').slice(0, 100)))
  } else {
    console.log('    ERROR:', JSON.stringify(site.json?.error || site.json))
  }

  // Probe 3: integrations settings — confirm this account has NO personal key
  const st = await req('GET', '/api/settings')
  console.log(`\n[3] settings GET ${st.status}`, JSON.stringify(st.json).slice(0, 300))
}
main().catch((e) => { console.error('diag crashed:', e.message); process.exit(1) })
