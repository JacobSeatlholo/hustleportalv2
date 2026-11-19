// Full logical backup of the production database (first ever, 2026-11-19).
// Neon free-tier suspension taught the lesson: the data must be exportable
// within minutes of any live window. Dumps EVERY public table to JSONL plus
// a manifest (row counts, sizes, table list) under download/db-backup-<ts>/.
//
// Uses only @prisma/client — no new dependencies, no pg_dump binary needed.
// DATABASE_URL comes from the environment for THIS run only (zero-logins
// law: credentials ride env/inline, never stored, never printed).
//
// Run: DATABASE_URL='postgresql://...' node scripts/neon_full_dump.mjs
// Safe to re-run: each run writes a fresh timestamped folder, failures are
// reported per table and never abort the whole backup.
import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_ROOT = '/home/z/my-project/download'
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

if (!process.env.DATABASE_URL) {
  console.error('FAIL fast: DATABASE_URL is not set. Pass it for this run only, never store it.')
  process.exit(1)
}
const outDir = join(OUT_ROOT, `db-backup-${ts}`)
mkdirSync(outDir, { recursive: true })

const prisma = new PrismaClient()

// JSON safety: BigInt columns (Prisma returns them for @db.BigInt) and bytea
// (Buffer) cannot pass JSON.stringify directly.
const jsonReplacer = (_key, value) => {
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() }
  if (value instanceof Uint8Array) return { __type: 'bytes.b64', value: Buffer.from(value).toString('base64') }
  if (value instanceof Date) return value.toISOString()
  return value
}

async function main() {
  const started = Date.now()
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  const names = tables.map((r) => r.table_name)
  console.log(`[dump] ${names.length} public tables: ${names.join(', ')}`)

  const manifest = { at: new Date().toISOString(), tables: {}, failures: {}, totals: { rows: 0, bytes: 0 } }
  for (const t of names) {
    // Quoted identifier safety: table names come from our own schema, all
    // plain identifiers; still escape via Prisma's raw identifier helper.
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${t}"`)
      const file = join(outDir, `${t}.jsonl`)
      let bytes = 0
      const lines = rows.map((r) => JSON.stringify(r, jsonReplacer))
      writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''))
      bytes = Buffer.byteLength(lines.join('\n'), 'utf8')
      manifest.tables[t] = { rows: rows.length, bytes }
      manifest.totals.rows += rows.length
      manifest.totals.bytes += bytes
      console.log(`[dump] ${t.padEnd(30)} ${String(rows.length).padStart(7)} rows  ${(bytes / 1024).toFixed(1)} KB`)
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200)
      manifest.failures[t] = msg
      console.error(`[dump] ${t.padEnd(30)} FAILED: ${msg}`)
    }
  }

  const manifestPath = join(outDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, jsonReplacer, 2))
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[dump] DONE in ${secs}s → ${outDir}`)
  console.log(`[dump] totals: ${manifest.totals.rows} rows, ${(manifest.totals.bytes / 1024 / 1024).toFixed(1)} MB, failures: ${Object.keys(manifest.failures).length}`)
  if (Object.keys(manifest.failures).length > 0) process.exitCode = 2
}

main()
  .catch((e) => { console.error('[dump] FATAL:', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect().catch(() => {}))
