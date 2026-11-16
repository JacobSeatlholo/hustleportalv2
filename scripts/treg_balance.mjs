// Reusable treg balance checker for sweep runs.
// Login as ops seat, GET /api/admin/exec/pool/verify, print balance + recent ledger.
// Run: node scripts/treg_balance.mjs
const BASE = 'https://www.hustleportal.online'

async function main() {
  const res = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'login',
      email: process.env.OPS_SEAT_EMAIL,
      password: process.env.OPS_SEAT_PASSWORD,
    }),
  })
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  if (!cookie) { console.error('LOGIN_FAILED status=' + res.status); process.exit(1) }
  const v = await fetch(BASE + '/api/admin/exec/pool/verify', { headers: { cookie } })
  const j = await v.json().catch(() => null)
  if (!j) { console.error('VERIFY_FAILED status=' + v.status); process.exit(1) }
  const bal = j?.treg?.balanceUsd ?? j?.balanceUsd ?? null
  console.log('BALANCE_USD=' + (bal === null ? 'unknown' : Number(bal).toFixed(4)))
  const recent = j?.ledger?.recent || j?.ledger || []
  if (Array.isArray(recent) && recent.length) {
    for (const e of recent.slice(0, 5)) {
      console.log('LEDGER ' + JSON.stringify(e))
    }
  }
}
main().catch((e) => { console.error('ERROR ' + e.message); process.exit(1) })
