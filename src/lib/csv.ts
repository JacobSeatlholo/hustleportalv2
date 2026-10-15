/** RFC 4180 CSV builder for /api/export. */

function esc(v: unknown): string {
  if (v == null) return ''
  let s = String(v)
  // Formula-injection guard: spreadsheet apps execute cells that open with
  // = + - @ (or tab/CR shortcuts). Prefixing with a tick keeps the data
  // readable and keeps a crafted export from running formulas on open.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
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
