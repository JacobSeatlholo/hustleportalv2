/**
 * The probe zoo — one shared lens for every KPI on the platform.
 *
 * The QA suites create hundreds of test accounts across a known set of throwaway
 * domains, plus a few house owned addresses (staff, demo, e2e). Without a shared
 * lens the exec dashboard inflates members, meetings and revenue with test bench
 * noise. These checks are PURE (no imports, no db) so client components can use
 * the exact same lens as the server routes.
 */

/** The QA suite's own domain (probe accounts from this build pipeline). */
export const QA_DOMAIN = 'hustleqa.example.com'

/** Throwaway domains the automated suites register against. */
const PROBE_DOMAINS = [
  QA_DOMAIN,
  'probe.local',
  'diagcheck.local',
  'testmail.co.za',
  'hustletest.co.za',
  'example.com',
  'example.org',
  'example.net',
  'mailinator.com',
  'mailinator.local',
  'test.co.za',
]

/** House owned product domains: staff, demo and e2e accounts live here. */
const HOUSE_DOMAINS = ['hustleportal.co.za', 'hustleportal.online']

function domainOf(email?: string | null): string | null {
  if (!email) return null
  const e = String(email).toLowerCase().trim()
  const at = e.lastIndexOf('@')
  if (at < 1 || at === e.length - 1) return null // malformed (e.g. a stray name with no @)
  return e.slice(at + 1)
}

/** True for automated test bench accounts and malformed rows. Never a real human. */
export function isProbeEmail(email?: string | null): boolean {
  const d = domainOf(email)
  if (!d) return true // malformed email rows are bench noise by definition
  return PROBE_DOMAINS.includes(d)
}

/** True for the company's own staff, demo and e2e accounts on house domains. */
export function isInternalEmail(email?: string | null): boolean {
  if (isProbeEmail(email)) return false
  const d = domainOf(email)
  return d !== null && HOUSE_DOMAINS.includes(d)
}
