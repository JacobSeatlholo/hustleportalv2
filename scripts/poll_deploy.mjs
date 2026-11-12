#!/usr/bin/env node
// Poll prod /api/health until build.sha matches the wanted commit (or timeout).
// Usage: node scripts/poll_deploy.mjs <commit-sha> [minutes]
const WANT = process.argv[2] || ''
const MINUTES = Number(process.argv[3]) || 40
const BASE = process.env.HP_BASE || 'https://www.hustleportal.online'
const DEADLINE = Date.now() + MINUTES * 60 * 1000
let last = ''
while (Date.now() < DEADLINE) {
  try {
    const res = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(20000) })
    const j = await res.json()
    last = j?.build?.sha || ''
    const short = last.slice(0, 7)
    if (WANT && short === WANT.slice(0, 7)) {
      console.log(`DEPLOYED ${short} dbPing=${j?.db?.ping} at ${new Date().toISOString()}`)
      process.exit(0)
    }
    console.log(`${new Date().toISOString()} waiting... prod at ${short || '?'} want ${WANT.slice(0, 7)}`)
  } catch (e) {
    console.log(`${new Date().toISOString()} poll error: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 60000))
}
console.log(`TIMEOUT waiting for ${WANT.slice(0, 7)}; prod still at ${last.slice(0, 7)}`)
process.exit(1)
