#!/usr/bin/env node
// HustlePortal — embedded Postgres admin (no psql/createdb binaries available in sandbox;
// this script is the DB admin interface). Resolves `pg` from ./pgtools/node_modules.
//
// Usage: node scripts/db_admin.mjs <command> [args]
//   ping                    — verify server connectivity
//   status                  — version, databases, tables in hustleportal + row counts
//   createdb [name]         — create database if missing (default hustleportal)
//   dropdb <name>           — terminate connections and drop database
//   tables                  — list tables in hustleportal
//   sql "<query>"           — run arbitrary SQL against hustleportal, print rows
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.HP_PG_PORT || 54329)
const HOST = '127.0.0.1'
const USER = 'postgres'
const DB = process.env.HP_DB || 'hustleportal'

function loadPg() {
  // 1) main project node_modules, 2) pgtools fallback
  try {
    return createRequire(import.meta.url)('pg')
  } catch {}
  try {
    const req = createRequire(fileURLToPath(new URL('../pgtools/package.json', import.meta.url)))
    return req('pg')
  } catch {
    console.error('FATAL: `pg` not found. Run: bash scripts/bootstrap_db.sh')
    process.exit(1)
  }
}

const { Client } = loadPg()

async function connect(db) {
  const c = new Client({ host: HOST, port: PORT, user: USER, database: db, connectionTimeoutMillis: 5000 })
  await c.connect()
  return c
}

async function dbExists(name) {
  const c = await connect('postgres')
  try {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    return r.rowCount > 0
  } finally {
    await c.end()
  }
}

const [cmd, ...args] = process.argv.slice(2)

async function main() {
  switch (cmd) {
    case 'ping': {
      const c = await connect(DB.startsWith('postgres') ? 'postgres' : (await dbExists(DB)) ? DB : 'postgres')
      const r = await c.query('SELECT version()')
      console.log(r.rows[0].version)
      await c.end()
      break
    }
    case 'createdb': {
      const name = args[0] || DB
      if (await dbExists(name)) {
        console.log(`exists: ${name}`)
      } else {
        const c = await connect('postgres')
        await c.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`)
        await c.end()
        console.log(`created: ${name}`)
      }
      break
    }
    case 'dropdb': {
      const name = args[0]
      if (!name) throw new Error('usage: dropdb <name>')
      const c = await connect('postgres')
      await c.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      )
      await c.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '')}"`)
      await c.end()
      console.log(`dropped: ${name}`)
      break
    }
    case 'tables': {
      const c = await connect(DB)
      const r = await c.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
      )
      r.rows.forEach((row) => console.log(row.tablename))
      await c.end()
      break
    }
    case 'status': {
      const ping = await connect('postgres')
      const v = await ping.query('SHOW server_version')
      const dbs = await ping.query(`SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname`)
      await ping.end()
      console.log(`server: PostgreSQL ${v.rows[0].server_version} @ ${HOST}:${PORT}`)
      console.log(`databases: ${dbs.rows.map((d) => d.datname).join(', ')}`)
      if (await dbExists(DB)) {
        const c = await connect(DB)
        const t = await c.query(
          `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
        )
        console.log(`tables in ${DB}: ${t.rowCount}`)
        for (const row of t.rows) {
          try {
            const n = await c.query(`SELECT count(*)::int AS n FROM "${row.tablename}"`)
            console.log(`  ${row.tablename.padEnd(22)} ${n.rows[0].n} rows`)
          } catch (e) {
            console.log(`  ${row.tablename.padEnd(22)} (error: ${e.message})`)
          }
        }
        await c.end()
      } else {
        console.log(`database ${DB} does not exist yet`)
      }
      break
    }
    case 'sql': {
      const q = args[0]
      if (!q) throw new Error('usage: sql "<query>"')
      const c = await connect(DB)
      const r = await c.query(q)
      if (r.rows && r.rows.length) console.log(JSON.stringify(r.rows, null, 2))
      console.log(`ok: ${r.command} ${r.rowCount ?? ''}`)
      await c.end()
      break
    }
    default:
      console.log('commands: ping | status | createdb [name] | dropdb <name> | tables | sql "<query>"')
      process.exit(cmd ? 1 : 0)
  }
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`)
  process.exit(1)
})
