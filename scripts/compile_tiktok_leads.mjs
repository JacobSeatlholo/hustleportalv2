#!/usr/bin/env node
/**
 * Compile the TikTok candidates into download/tiktok_leads.csv (rebuild).
 * Usage: node scripts/compile_tiktok_leads.mjs [newOnlyCap]
 *
 * FREE: reads the platform review queue (GET /api/admin/exec/xpitch/review),
 * marks NEW keepers (not yet in src/lib/xpitchSeed.ts, band fresh), and writes
 * the CSV the seed generator consumes. No treg calls — freshness was stamped
 * by the sweep's metered door already; cached rows skip free by design.
 */
import { login, apiGet } from './xpitch_common.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const NAME = 'compile_tiktok_leads'
const cookie = login(NAME)

const { status, json } = await apiGet(cookie, '/api/admin/exec/xpitch/review', 60_000)
if (status !== 200 || !json?.ok) {
  console.error(`[${NAME}] FAIL fast: review queue ${status}: ${JSON.stringify(json).slice(0, 160)}`)
  process.exit(2)
}

// The seed's existing handles: platform:handle -> true (never re-queued as new)
let existing = new Set()
const SEED = 'src/lib/xpitchSeed.ts'
if (existsSync(SEED)) {
  const src = readFileSync(SEED, 'utf8')
  for (const m of src.matchAll(/"handle":\s*"([^"]+)"[\s\S]*?"platform":\s*"([^"]+)"/g)) {
    existing.add(`${m[2]}:${m[1].toLowerCase()}`)
  }
}

const rows = (json.queue || []).filter((r) => r.platform === 'tiktok')
const freshBand = (r) => (r.fresh === 'fresh' ? 'fresh' : r.fresh === 'warm' ? 'warm' : r.fresh === 'stale' ? 'stale' : r.fresh || 'unknown')
const csv = [
  ['handle', 'name', 'trade', 'city', 'followers', 'url', 'phone', 'email', 'lastPost', 'band', 'isNewKeeper', 'note'].join(','),
  ...rows.map((r) => {
    const band = freshBand(r)
    const isNew = !existing.has(`tiktok:${String(r.handle).toLowerCase()}`) && band === 'fresh'
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    return [
      cell(r.handle), cell(r.name), cell(r.trade), cell(r.city), cell(r.followers || 0),
      cell(r.url), cell(r.phone || ''), cell(r.email || ''), cell(r.lastPost || ''), cell(band),
      cell(isNew ? 'YES' : ''), cell(r.note || ''),
    ].join(',')
  }),
].join('\n')

mkdirSync(dirname('download/tiktok_leads.csv'), { recursive: true })
writeFileSync('download/tiktok_leads.csv', csv + '\n')
const newKeepers = rows.filter((r) => !existing.has(`tiktok:${String(r.handle).toLowerCase()}`) && freshBand(r) === 'fresh')
console.log(`[${NAME}] review queue: ${rows.length} tiktok rows; NEW fresh keepers: ${newKeepers.length}`)
for (const k of newKeepers.slice(0, 5)) {
  console.log(`[${NAME}]   new: @${k.handle} | ${k.trade} | ${k.city} | ${k.followers || 0} followers | phone ${k.phone ? 'yes' : 'no'} email ${k.email ? 'yes' : 'no'}`)
}
console.log(`[${NAME}] wrote download/tiktok_leads.csv (${rows.length} rows, band stamps intact; warm/stale NEVER enter the seed)`)
