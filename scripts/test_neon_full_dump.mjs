// Test harness for neon_full_dump.mjs: spins up a throwaway local Postgres
// (pgserver bundles real binaries, no root), creates a schema that exercises
// the nasty column types (FKs, bigint, timestamptz, jsonb, bytea, nulls),
// runs the dump script against it, and verifies the output files.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

console.log('[test] booting local postgres (python pgserver)...')
const uri = execFileSync('/home/z/.venv/bin/python', ['scripts/boot_test_postgres.py'], { encoding: 'utf8' }).trim().split('\n').at(-1)
console.log('[test] local postgres up')

console.log('[test] running dump script...')
execFileSync('node', ['scripts/neon_full_dump.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: uri },
})

const dir = readdirSync('/home/z/my-project/download').filter((d) => d.startsWith('db-backup-')).sort().at(-1)
const full = `/home/z/my-project/download/${dir}`
const manifest = JSON.parse(readFileSync(`${full}/manifest.json`, 'utf8'))
const parent = readFileSync(`${full}/parent_tbl.jsonl`, 'utf8').trim().split('\n')
const child = readFileSync(`${full}/child_tbl.jsonl`, 'utf8').trim().split('\n')

const checks = []
const ok = (name, cond) => checks.push([name, cond])
ok('manifest lists 2 tables', Object.keys(manifest.tables).length === 2)
ok('manifest row counts', manifest.tables.parent_tbl.rows === 2 && manifest.tables.child_tbl.rows === 2)
ok('parent row2 name null', JSON.parse(parent[1]).name === null)
ok('bigint encoded', JSON.parse(parent[0]).id.__type === 'bigint' || typeof JSON.parse(parent[0]).id === 'number')
ok('bytea base64', JSON.parse(parent[0]).avatar.__type === 'bytes.b64')
ok('jsonb survives as object', JSON.parse(parent[0]).meta?.slug === 'trinitydirect')
ok('timestamptz ISO', !isNaN(Date.parse(JSON.parse(parent[0]).created)))
ok('child nulls intact', JSON.parse(child[1]).parent_id === null && JSON.parse(child[1]).amount === null)
ok('no failures', Object.keys(manifest.failures).length === 0)

let pass = 0
for (const [name, cond] of checks) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (cond) pass++
}
console.log(`[test] ${pass}/${checks.length} checks passed. Backup dir: ${full}`)
process.exit(pass === checks.length ? 0 : 1)
