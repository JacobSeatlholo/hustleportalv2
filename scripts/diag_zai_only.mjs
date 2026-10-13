const BASE = 'https://www.hustleportal.online'
let cookie = ''
async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 55_000),
  })
  const sc = res.headers.get('set-cookie')
  if (sc && !cookie) cookie = sc.split(';')[0]
  return res
}
const stamp = Date.now()
const reg = await req('/api/auth', {
  method: 'POST',
  body: JSON.stringify({ action: 'register', email: `diag_${stamp}@hustleqa.example.com`, password: `Qa!${stamp}x`, name: 'Diag' }),
})
console.log('register', reg.status)
const d = await req('/api/ai/diagnose')
const j = await d.json().catch(() => null)
console.log(JSON.stringify(j?.zai, null, 2))
