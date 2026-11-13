#!/usr/bin/env node
/**
 * TikTok fresh-leads sweep (rebuild, Task: daily fresh-leads duty).
 * Usage: node scripts/tiktok_sweep.mjs [asks]   (default 4)
 *
 * Rides the platform's own metered treg door (POST /api/admin/exec/xpitch/search,
 * platform 'tiktok'): ~$0.001 per search call + capped freshness stamps.
 * The sweep cap (TIKTOK_SWEEP_CAP_USD, default $0.03) stops the run before the
 * budget, not after. Candidates land in the platform's review queue — the
 * boss's go/no-go stays the only door into the pitch list.
 */
import { login, tregTruth, searchAsk, picksForToday, TIKTOK_ASKS, SWEEP_CAPS } from './xpitch_common.mjs'

const NAME = 'tiktok_sweep'
const asks = Math.max(1, Math.min(8, Number(process.argv[2]) || 4))

const cookie = await login(NAME)

const truth = await tregTruth(cookie)
if (!truth.ok) {
  console.error(`[${NAME}] FAIL fast: cannot read the treg balance — ${truth.error}. Nothing was spent by this script.`)
  process.exit(2)
}
const treg = truth.treg || {}
console.log(`[${NAME}] treg enabled=${treg.enabled} balanceUsd=${treg.balanceUsd}`)
if (treg.enabled === false) {
  console.error(`[${NAME}] FAIL fast: TREG_TOKEN is not set on the deployment — no external search possible. $0 spent.`)
  process.exit(2)
}
const budgetBefore = truth.budget ? Number(truth.budget.spentUsd || 0) : 0

const myAsks = picksForToday(TIKTOK_ASKS, asks)
console.log(`[${NAME}] today's asks: ${myAsks.join(' | ')}`)

let spendUsd = 0
let asksOk = 0
const perAsk = []
for (const ask of myAsks) {
  if (spendUsd >= SWEEP_CAPS.tiktok) {
    console.log(`[${NAME}] cap reached ($${spendUsd.toFixed(4)} of $${SWEEP_CAPS.tiktok.toFixed(2)}) — stopping before "${ask}".`)
    break
  }
  const r = await searchAsk(cookie, 'tiktok', ask, { maxFresh: 2 })
  const j = r.json || {}
  const cost = Number(j.costUsd || 0)
  spendUsd += cost
  if (r.status === 200 && j.ok) {
    asksOk++
    perAsk.push({ ask, cost, southAfrican: j.southAfrican, added: j.added, freshChecked: j.freshChecked })
    console.log(`[${NAME}] OK "${ask}": SA ${j.southAfrican}/${j.providerRows} rows, +${j.added} queued, freshness ${j.freshChecked}, $${cost.toFixed(4)}`)
  } else {
    perAsk.push({ ask, cost, error: j.error || `HTTP ${r.status}` })
    console.log(`[${NAME}] MISS "${ask}": ${j.error || `HTTP ${r.status}`} ($${cost.toFixed(4)})`)
    if (j.budgetReached) {
      console.log(`[${NAME}] probe budget reached on the platform — stopping the sweep cleanly.`)
      break
    }
  }
}

console.log(`[${NAME}] sweep done: ${asksOk}/${myAsks.length} asks ok, spend this sweep $${spendUsd.toFixed(4)} (cap $${SWEEP_CAPS.tiktok.toFixed(2)}), run-cap context: probe spent before this sweep $${budgetBefore.toFixed(4)} of $${SWEEP_CAPS.run.toFixed(2)} run cap.`)
process.exit(asksOk > 0 ? 0 : asksOk === 0 && spendUsd === 0 ? 3 : 0)
