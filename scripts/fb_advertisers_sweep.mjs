#!/usr/bin/env node
/**
 * Facebook (Meta Ad Library) active-advertiser sweep (rebuild).
 * Usage: node scripts/fb_advertisers_sweep.mjs [asks]   (default 2)
 *
 * MONEY LAW, up front: the ONLY facebook door in the treg catalog is
 * anyapi.facebook.search_pages at $0.1221 per call (the platform route
 * enforces confirmCost:true for it). That price is ~4x this sweep's default
 * cap ($0.03), so by default this script REFUSES and reports instead of
 * spending — the $0.20 run cap survives by construction. To actually run it,
 * export FB_SWEEP_CAP_USD >= 0.13 deliberately (an informed decision, the
 * same spirit as the route's confirmCost gate).
 */
import { login, tregTruth, searchAsk, picksForToday, SWEEP_CAPS } from './xpitch_common.mjs'

const NAME = 'fb_advertisers_sweep'
const FB_CALL_USD = 0.1221
const asks = Math.max(1, Math.min(3, Number(process.argv[2]) || 2))

if (SWEEP_CAPS.facebook < FB_CALL_USD) {
  console.log(`[${NAME}] REFUSE by money law: one facebook search call costs $${FB_CALL_USD.toFixed(4)} but FB_SWEEP_CAP_USD is $${SWEEP_CAPS.facebook.toFixed(2)}.`)
  console.log(`[${NAME}] Nothing was spent. To run it deliberately: FB_SWEEP_CAP_USD=0.13 node scripts/fb_advertisers_sweep.mjs ${asks} (check the run cap first: ${asks} call(s) = $${(FB_CALL_USD * asks).toFixed(4)}).`)
  process.exit(3)
}

const cookie = login(NAME)

const truth = await tregTruth(cookie)
if (!truth.ok) {
  console.error(`[${NAME}] FAIL fast: cannot read the treg balance — ${truth.error}. Nothing was spent by this script.`)
  process.exit(2)
}
const treg = truth.treg || {}
console.log(`[${NAME}] treg enabled=${treg.enabled} balanceUsd=${treg.balanceUsd}`)
if (treg.enabled === false) {
  console.error(`[${NAME}] FAIL fast: TREG_TOKEN is not set on the deployment. $0 spent.`)
  process.exit(2)
}

const FB_ASKS = [
  'active facebook advertisers salon johannesburg',
  'active facebook advertisers restaurant cape town',
  'active facebook advertisers plumber durban',
]
const myAsks = picksForToday(FB_ASKS, asks)
console.log(`[${NAME}] today's asks: ${myAsks.join(' | ')}`)

let spendUsd = 0
let asksOk = 0
for (const ask of myAsks) {
  if (spendUsd + FB_CALL_USD > SWEEP_CAPS.facebook) {
    console.log(`[${NAME}] cap guard: $${spendUsd.toFixed(4)} spent + $${FB_CALL_USD.toFixed(4)} next call would pass $${SWEEP_CAPS.facebook.toFixed(2)} — stopping.`)
    break
  }
  const r = await searchAsk(cookie, 'facebook', ask, { confirmCost: true, fresh: false })
  const j = r.json || {}
  const cost = Number(j.costUsd || 0)
  spendUsd += cost
  if (r.status === 200 && j.ok) {
    asksOk++
    console.log(`[${NAME}] OK "${ask}": SA ${j.southAfrican}/${j.providerRows} rows, +${j.added} queued, $${cost.toFixed(4)}`)
  } else {
    console.log(`[${NAME}] MISS "${ask}": ${j.error || `HTTP ${r.status}`} ($${cost.toFixed(4)})`)
    if (j.budgetReached) break
  }
}
console.log(`[${NAME}] sweep done: ${asksOk}/${myAsks.length} asks ok, spend $${spendUsd.toFixed(4)} (cap $${SWEEP_CAPS.facebook.toFixed(2)})`)
process.exit(asksOk > 0 || spendUsd === 0 ? 0 : 0)
