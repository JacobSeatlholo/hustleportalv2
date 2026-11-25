import { redirect } from 'next/navigation'

// The /tasks deep link, made real (Hayley case, boss 2026-11-25): task emails
// have always pointed at hustleportal/tasks, which 404'd because the workspace
// lives at /app with client-side views. The workspace honors ?view= deep links,
// so this page turns the old (and every future) email CTA into a working door
// straight into the Tasks module.
export default function TasksRedirect() {
  redirect('/app?view=tasks')
}
