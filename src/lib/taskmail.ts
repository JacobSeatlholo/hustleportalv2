/**
 * The task-assignment announcement (Hayley case, boss 2026-11-25): "send
 * updates directly to their inboxes" was promised and the email never
 * existed — a sent task was invisible until the teammate happened to log
 * in. Both create (POST /api/tasks) and reassign/forward (PATCH
 * /api/tasks/[id]) announce through this one door, suppression-checked,
 * best-effort, same laws as the comment fanout. The CTA rides /tasks,
 * the redirect page that lands straight on the Tasks module.
 */
import { db } from '@/lib/db'
import { sendSystemMail } from '@/lib/mailer'

export async function sendTaskAssignedMail(task: {
  id: string
  title: string
  notes: string | null
  dueDate: Date | null
  assignee: { id: string; name: string; email: string } | null
  team: { id: string; name: string } | null
}, creatorName: string): Promise<void> {
  try {
    if (!task.assignee?.email) return
    const dead = await db.suppression.findMany({ where: { email: task.assignee.email }, select: { email: true } })
    if (dead.length > 0) return
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://www.hustleportal.online'
    const teamLine = task.team ? ` on the ${task.team.name} team` : ''
    await sendSystemMail({
      to: task.assignee.email,
      subject: `${creatorName} sent you a task: ${task.title}`,
      body: [
        `Hi ${task.assignee.name.split(' ')[0] || 'there'},`,
        '',
        `${creatorName} assigned you a task${teamLine}:`,
        '',
        `"${task.title}"`,
        task.dueDate
          ? `Due: ${new Date(task.dueDate).toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          : '',
        task.notes ? `Notes: ${String(task.notes).slice(0, 300)}` : '',
        '',
        `Open your tasks: ${appUrl}/tasks`,
        '',
        'The task waits in your Tasks module — open it to start the record.',
      ].filter(Boolean).join('\n'),
      title: task.title,
      headline: 'Task assigned to you',
      value: { text: task.title.slice(0, 140), caption: `From ${creatorName}${teamLine}` },
      ctaLabel: 'Open your tasks',
      ctaUrl: `${appUrl}/tasks`,
      preheader: `${creatorName} sent you a task`,
    })
  } catch {
    // Best effort: the task is already saved and recorded.
  }
}
