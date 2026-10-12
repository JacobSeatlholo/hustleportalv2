import { db } from '@/lib/db'
import { fail, num, ok, optDate, optStr, parseBody, str } from '@/lib/api'

export async function GET() {
  const payments = await db.payment.findMany({
    orderBy: { paidAt: 'desc' },
    include: { invoice: { select: { id: true, number: true, status: true, clientId: true, client: { select: { name: true, company: true } } } } },
  })
  return ok(payments)
}

export async function POST(req: Request) {
  const body = await parseBody(req)
  const invoiceId = str(body.invoiceId)
  const amount = num(body.amount)
  if (!invoiceId) return fail('invoiceId is required')
  if (amount <= 0) return fail('Payment amount must be greater than zero')
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, items: true } })
  if (!invoice) return fail('Invoice not found', 404)

  const payment = await db.payment.create({
    data: {
      invoiceId,
      amount,
      method: str(body.method, 'BANK'),
      paidAt: optDate(body.paidAt) ?? new Date(),
      note: optStr(body.note),
    },
  })

  // Auto-mark invoice PAID when balance reaches zero
  const subtotal = invoice.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
  const total = subtotal * (1 + invoice.taxRate / 100)
  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0) + amount
  if (invoice.status !== 'PAID' && paid >= total - 0.005) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } })
  }

  return ok(payment, 201)
}
