// Task 132 QA: lead lookup memory + website door, no AI, no prod, no money.
// Self-contained: boots its own embedded postgres on port 31432, pushes the
// real schema, exercises the doors end to end. Run: bun scripts/task132_reveal_doors_qa.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const PG_PORT = 31432
const PG_USER = 'qa'
const PG_PASS = 'qa'
const PG_DB = 'qa132'
const QA_BASE = new URL('../.qaenv/', import.meta.url).pathname

process.env.DATABASE_URL = `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`

const { default: EmbeddedPostgres } = await import(pathToFileURL(`${QA_BASE}node_modules/embedded-postgres/dist/index.js`))
const { execSync } = await import('node:child_process')

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}${extra ? ` :: ${extra}` : ''}`) }
  else { failed++; console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ''}`) }
}

function serve(html) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html[req.url] ?? '<html><body>empty</body></html>')
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}
import http from 'node:http'

const HOME_NOISE = `<html><body>
  <img src="a@2x.png"> contact us at test@example.com
  <script>sentry.io flavor</script> nothing real here
</body></html>`

const CONTACT_PAGE = `<html><body>
  <h1>Spar QA</h1>
  <a href="mailto:info@sparqa.co.za">mail us</a>
  <a href="tel:+27214444444">call</a>
  or dial 021 444 4444 today. noise: staff@example.com, shot@2x.png, bug@sentry.io
</body></html>`

const dataDir = mkdtempSync(`${tmpdir()}/hpqa-`)
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: PG_USER,
  password: PG_PASS,
  port: PG_PORT,
  persistent: false,
})

async function main() {
  console.log('== Task 132 reveal doors QA (embedded pg) ==')
  await pg.initialise()
  await pg.start()
  await pg.createDatabase(PG_DB)

  // Push the REAL schema, then import the app code against it.
  execSync('npx prisma db push --skip-generate', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env },
    stdio: 'pipe',
  })
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  const lib = await import('../src/lib/leadlookup.ts')
  const { companyKeyFor, cacheGetContact, cachePutContact, siteContactDoor, bumpRevealStats } = lib

  // 1. company key normalisation
  const k1 = companyKeyFor('Spar', 'Observatory', null)
  const k2 = companyKeyFor('  SPAR!! ', ' Observatory ', '')
  check('companyKey normalises name+city', k1 === k2, `${k1} vs ${k2}`)
  const k3 = companyKeyFor('Spar', 'Observatory', 'https://www.sparqa.co.za/contact')
  check('companyKey folds website host', k3 === 'spar|observatory|sparqa.co.za', k3)

  // 2. website door: noise-only homepage must yield nothing...
  const a = await serve({ '/': HOME_NOISE })
  const none = await siteContactDoor(`http://127.0.0.1:${a.port}`)
  check('noise-only site yields no door', none === null)
  a.srv.close()

  // 3. ...and the real contact page yields the clean doors
  const b = await serve({ '/': '<html>placeholder</html>', '/contact': CONTACT_PAGE })
  const hit = await siteContactDoor(`http://127.0.0.1:${b.port}/about`) // no contact here, chains to /contact
  check('website door finds email', hit?.email === 'info@sparqa.co.za', hit?.email)
  check('website door finds phone', hit?.phone === '+27214444444', hit?.phone)
  check('website door names its source', /own website .*\/contact/.test(hit?.source || ''), hit?.source)
  b.srv.close()

  // 4. cache roundtrip on real pg
  const key = 'sparqa|observatory|'
  await cachePutContact(key, { email: 'info@sparqa.co.za', phone: '0214444444', source: 'their own website (https://sparqa.co.za/contact)' })
  const got = await cacheGetContact(key)
  check('cache stores and returns', got?.email === 'info@sparqa.co.za' && got?.phone === '0214444444', JSON.stringify(got))
  await cachePutContact(key, { phone: '0215555555', source: 'updated' })
  const upd = await db.leadLookupCache.findUnique({ where: { companyKey: key } })
  check('upsert keeps email, updates phone', upd?.email === 'info@sparqa.co.za' && upd?.phone === '0215555555')
  await cachePutContact('nobody|nowhere|', { source: 'x' })
  check('empty put is a no-op', !(await db.leadLookupCache.findUnique({ where: { companyKey: 'nobody|nowhere|' } })))
  check('missing key reads null', (await cacheGetContact('ghost|town|')) === null)
  await new Promise((r) => setTimeout(r, 100)) // let the fire-and-forget hit counter land
  const hitRow = await db.leadLookupCache.findUnique({ where: { companyKey: key } })
  check('hits counter climbs on reads', hitRow?.hits === 1, String(hitRow?.hits)) // exactly one successful read above

  // 5. stats counter
  await bumpRevealStats('lookups'); await bumpRevealStats('lookups'); await bumpRevealStats('site')
  const stats = JSON.parse((await db.platformConfig.findUnique({ where: { key: 'REVEAL_STATS' } })).value)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
  check('stats count the doors', stats[day]?.lookups === 2 && stats[day]?.site === 1, JSON.stringify(stats[day]))

  await db.$disconnect()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => {
    try { await pg.stop() } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  })
