/** Jitsi meet links for appointments, no accounts, no infrastructure needed. */

export function jitsiMeetLink(title?: string | null): string {
  const slug = (title || 'meeting')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const rand = Math.random().toString(36).slice(2, 8)
  return `https://meet.jit.si/hustleportal-${slug || 'meet'}-${rand}`
}
