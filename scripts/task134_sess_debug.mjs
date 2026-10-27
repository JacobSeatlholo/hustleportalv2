const BASE = 'https://www.hustleportal.online'
const OPS = { email: 'ops@hustleqa.example.com', password: 'OpsSeat2026!Hustle' }
let cookie = ''
async function call(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  return { status: res.status, text, setCookie: res.headers.get('set-cookie') }
}
const login = await call('/api/auth', { method: 'POST', body: { action: 'login', ...OPS } })
cookie = (login.setCookie || '').split(';')[0]
console.log('login:', login.status, 'cookie head:', cookie.slice(0, 40))
const me = await call('/api/auth/me')
console.log('me:', me.status, me.text.slice(0, 200))
const lq = await call('/api/admin/exec/lead-quality')
console.log('lead-quality:', lq.status, lq.text.slice(0, 200))
const feed = await call('/api/admin/exec')
console.log('feed:', feed.status, feed.text.slice(0, 150))
