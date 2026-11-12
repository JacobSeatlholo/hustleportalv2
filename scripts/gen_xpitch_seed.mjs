#!/usr/bin/env node
/**
 * Merge the day's NEW fresh keepers into the pipeline seed (rebuild).
 * Usage: node scripts/gen_xpitch_seed.mjs
 *
 * Reads download/tiktok_leads.csv + download/fb_leads.csv (the compile
 * scripts' output), keeps ONLY rows flagged isNewKeeper=YES (fresh band,
 * <=30 days since last post — warm/stale/unknown NEVER enter), dedupes
 * against src/lib/xpitchSeed.ts by platform:handle, and rewrites the seed
 * file with the same header law. After this, the deploy step is:
 *   git add src/lib/xpitchSeed.ts && git commit -m 'daily fresh leads' && push
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const NAME = 'gen_xpitch_seed'
const SEED = 'src/lib/xpitchSeed.ts'
const SOURCES = ['download/tiktok_leads.csv', 'download/fb_leads.csv']

// Parse the current seed file (header comment preserved verbatim).
if (!existsSync(SEED)) {
  console.error(`[${NAME}] FAIL: ${SEED} missing — nothing to merge into.`)
  process.exit(2)
}
const src = readFileSync(SEED, 'utf8')
const header = src.slice(0, src.indexOf('export interface'))
const m = src.match(/XPITCH_SEED: XPitchSeedLead\[\] = (\[[\s\S]*?\])\s*\n/)
if (!m) {
  console.error(`[${NAME}] FAIL: could not parse the XPITCH_SEED array from ${SEED}.`)
  process.exit(2)
}
const current = JSON.parse(m[1].replace(/,\s*\]$/, ']'))

const key = (platform, handle) => `${String(platform).toLowerCase()}:${String(handle).toLowerCase()}`
const seen = new Set(current.map((r) => key(r.platform, r.handle)))

// CSV reader with quoted-cell support (the compile scripts write quotes).
function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const head = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''))
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row = {}
    head.forEach((h, i) => (row[h] = (cells[i] ?? '').replace(/^"|"$/g, '')))
    return row
  })
}
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

const FRESH_MAX_DAYS = 30
let added = 0
const additions = []
for (const file of SOURCES) {
  if (!existsSync(file)) continue
  for (const row of parseCsv(readFileSync(file, 'utf8'))) {
    if (row.isNewKeeper !== 'YES') continue
    // Resolve the platform FIRST — the CSV carries no platform column (each
    // compile script pre-filters by platform), so the dedupe key must not
    // read it raw or every row would dedupe against 'undefined:handle'.
    const platform = row.platform === 'fb' || row.platform === 'facebook' ? 'facebook' : 'tiktok'
    if (seen.has(key(platform, row.handle))) continue
    // Double-check the freshness law from the date itself, not just the stamp.
    if (row.lastPost) {
      const days = Math.floor((Date.now() - new Date(row.lastPost).getTime()) / 86_400_000)
      if (Number.isFinite(days) && days > FRESH_MAX_DAYS) continue
    }
    additions.push({
      handle: row.handle,
      name: row.name || row.handle,
      trade: row.trade || 'unsorted',
      city: row.city || 'SA',
      followers: Number(row.followers) || 0,
      url: row.url || (platform === 'tiktok' ? `https://www.tiktok.com/@${row.handle}` : row.url),
      phone: row.phone || '',
      email: row.email || '',
      platform,
      lastPost: row.lastPost || '',
      fresh: 'fresh',
    })
    seen.add(key(platform, row.handle))
    added++
  }
}

// The seed's TS type is platform: 'x' | 'tiktok' — facebook keepers stay in
// the CSV for the boss's eyes until he asks for a type change. Last wall:
const seedable = additions.filter((a) => a.platform === 'tiktok')

const merged = [...current, ...seedable]
const body = `export const XPITCH_SEED: XPitchSeedLead[] = ${JSON.stringify(merged, null, 2)}\n`

writeFileSync(SEED, header + body)
console.log(`[${NAME}] seed now ${merged.length} entries (${seedable.length} new fresh keepers merged; ${additions.length - seedable.length} non-tiktok rows held back by the seed's platform law)`)
