// Quick verification that a given DATABASE_URL works with Prisma Client.
// Usage: DATABASE_URL="..." bun scripts/verify_db.ts
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const [users, teams, leads, clients, tasks, txs, entries] = await Promise.all([
    db.user.count(),
    db.team.count(),
    db.lead.count(),
    db.client.count(),
    db.task.count(),
    db.creditTx.count(),
    db.financeEntry.count(),
  ])
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' } })
  console.log(JSON.stringify({ users, teams, leads, clients, tasks, creditTxs: txs, financeEntries: entries, admin: admin?.email }, null, 2))
}

main()
  .catch((e) => {
    console.error('DB ERROR:', e.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
