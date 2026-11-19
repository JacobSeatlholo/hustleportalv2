// Boss-authorized resend (2026-11-19): fire the password-reset email to
// trinitydirectint@gmail.com via the normal public forgot flow. No provider
// creds here — the platform sends it. Rate limit is 3/hour per email; each
// failed 500 does NOT consume an email (gates pass, then the DB call throws
// before any mail). Run: node scripts/resend_reset_trinitydirect.mjs
const BASE = 'https://www.hustleportal.online'
const EMAIL = 'trinitydirectint@gmail.com'

const res = await fetch(BASE + '/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'forgot', email: EMAIL }),
})
const j = await res.json().catch(() => null)
console.log('HTTP', res.status, JSON.stringify(j))
if (res.ok) {
  console.log('SENT: the reset email for ' + EMAIL + ' is on its way (neutral API reply by design).')
  console.log('Verify inbox arrival, or check the platform Mail status via the exec door.')
} else {
  console.log('NOT SENT: database or service still down. Retry when /api/health db.ping is true.')
}
