/** RFC 4180 CSV builder for /api/export. */

function esc(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (rows.length === 0) return headers ? headers.map(esc).join(',') + '\r\n' : ''
  const cols = headers ?? Object.keys(rows[0])
  const head = cols.map(esc).join(',')
  const body = rows
    .map((r) => cols.map((c) => esc(r[c])).join(','))
    .join('\r\n')
  return head + '\r\n' + body + '\r\n'
}

export function csvFilename(type: string): string {
  const d = new Date().toISOString().slice(0, 10)
  return `hustleportal-${type}-${d}.csv`
}
