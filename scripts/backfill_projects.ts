/**
 * Backfill: ensure every user has a default "My Business" workspace and
 * attach any leads/clients/finance rows (plus invoices/appointments) that
 * have no projectId to it. Idempotent — safe to run repeatedly.
 *
 * Run: bun scripts/backfill_projects.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const users = await db.user.findMany({ select: { id: true, businessName: true, name: true } })
  let touched = 0

  for (const user of users) {
    let project = await db.project.findFirst({ where: { userId: user.id, isDefault: true } })
    if (!project) {
      project = await db.project.create({
        data: {
          userId: user.id,
          name: user.businessName || `${user.name || 'My'}'s Business`,
          isDefault: true,
        },
      })
      console.log(`+ created default workspace for ${user.id}: "${project.name}"`)
    }

    const [leads, clients, finance, invoices, appointments] = await Promise.all([
      db.lead.updateMany({ where: { userId: user.id, projectId: null }, data: { projectId: project.id } }),
      db.client.updateMany({ where: { userId: user.id, projectId: null }, data: { projectId: project.id } }),
      db.financeEntry.updateMany({ where: { userId: user.id, projectId: null }, data: { projectId: project.id } }),
      db.invoice.updateMany({ where: { userId: user.id, projectId: null }, data: { projectId: project.id } }),
      db.appointment.updateMany({ where: { userId: user.id, projectId: null }, data: { projectId: project.id } }),
    ])

    const count = leads.count + clients.count + finance.count + invoices.count + appointments.count
    if (count > 0) {
      touched += count
      console.log(`  user ${user.id}: attached ${leads.count} leads, ${clients.count} clients, ${finance.count} finance, ${invoices.count} invoices, ${appointments.count} appointments`)
    }
  }

  console.log(`Backfill done — ${touched} rows attached to default workspaces.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
