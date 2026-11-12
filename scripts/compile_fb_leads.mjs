#!/usr/bin/env node
/**
 * Compile the Facebook candidates into download/fb_leads.csv (rebuild).
 * Usage: node scripts/compile_fb_leads.mjs
 *
 * FREE: reads the platform review queue, marks NEW fresh keepers, writes the
 * CSV the seed generator consumes. Facebook rows carry no freshness endpoint
 * in the catalog, so their band reads 'unknown' unless the platform stamped
 * it — and unknown NEVER enters the seed (fresh-only law).
 */
import { login, apiGet } from './xpitch_common.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const NAME = 'compile_fb_leads'
const cookie = login(NAME)

const { status, json } = await apiGet(cookie, '/api/admin/exec/xpitch/review', 60_000)
if (status !== 200 || !json?.ok) {
  console.error(`[${NAME}] FAIL fast: review queue ${status}: ${JSON.stringify(json).slice(0, 160)}`)
  process.exit(2)
}

let existing = new Set()
const SEED = 'src/lib/xpitchSeed.ts'
if (existsSync(SEED)) {
  const src = readFileSync(SEED, 'utf8')
  for (const m of src.matchAll(/"handle":\s*"([^"]+)"[\s\S]*?"platform":\s*"([^"]+)"/g)) {
    existing.add(`${m[2]}:${m[1].toLowerCase()}`)
  }
}

const rows = (json.queue || []).filter((r) => r.platform === 'facebook')
const csv = [
  ['handle', 'name', 'trade', 'city', 'followers', 'url', 'phone', 'email', 'lastPost', 'band', 'isNewKeeper', 'note'].join(','),
  ...rows.map((r) => {
    const band = r.fresh || 'unknown'
    const isNew = !existing.has(`facebook:${String(r.handle).toLowerCase()}`) && band === 'fresh'
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    return [
      cell(r.handle), cell(r.name), cell(r.trade), cell(r.city), cell(r.followers || 0),
      cell(r.url), cell(r.phone || ''), cell(r.email || ''), cell(r.lastPost || ''), cell(band),
      cell(isNew ? 'YES' : ''), cell(r.note || ''),
    ].join(',')
  }),
].join('\n')

mkdirSync(dirname('download/fb_leads.csv'), { recursive: true })
writeFileSync('download/fb_leads.csv', csv + '\n')
const newKeepers = rows.filter((r) => !existing.has(`facebook:${String(r.handle).toLowerCase()}`) && (r.fresh || 'unknown') === 'fresh')
console.log(`[${NAME}] review queue: ${rows.length} facebook rows; NEW fresh keepers: ${newKeepers.length}`)
console.log(`[${NAME}] wrote download/fb_leads.csv (${rows.length} rows; unknown band never enters the seed)`)
