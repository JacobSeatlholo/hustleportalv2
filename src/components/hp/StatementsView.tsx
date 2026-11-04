'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, STAGES } from './shared'
import { useHp } from './store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Printer, Plus, Trash2, FileText, X, Pencil, Link2, Mail, Send, Loader2 } from 'lucide-react'

// Statements — the Simple Eternity Holdings billing book. Internal door: the
// master account, exec seats and the master's own team (server gated; the nav
// item only renders when /api/auth/me says statementAccess). The printable
// sheet reproduces the boss's Canva statement template 1:1 on the template's
// own 1004x1418 grid (every coordinate below is a template pixel), so what
// prints is exactly what he has always sent — then "Save as PDF" replaces
// Canva entirely.
//
// The book follows the records (the boss's law):
//   * lines are editable in place — pencil on any row;
//   * accounts with Auto-invoices on receive their client's sent/paid
//     invoices as synced lines (marked linked) automatically;
//   * editing a linked line takes it over — it stops following the invoice;
//   * the print runs to PRINT DAY: everything dated up to today prints, so a
//     line added minutes ago can never be missing from the paper.

interface Entry {
  id: string
  date: string
  product: string | null
  remarks: string
  quantity: string | null
  amount: number
  kind: string
  sourceRef?: string | null
}

interface Account {
  id: string
  refNo: string
  clientName: string
  address: string | null
  email: string | null
  website: string | null
  phone: string | null
  recipientVat: string | null
  recipientReg: string | null
  balanceBfwd: number
  autoSync?: boolean
  balance: number
  entries: Entry[]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const BOX = '#111111'
const GRAY = '#E6E6E6'
const LINK = '#4C4CFF'
const INK = '#1A1A1A'
const SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif'

function fmtPlain(n: number): string {
  // The template's own voice: comma thousands, dot decimals — spelled out by
  // hand because en-ZA locale data groups with a SPACE on some machines, which
  // is exactly how the Amount Due figures drifted back onto the Total|AmountDue
  // divider. The printed sheet never leans on the viewer's ICU again.
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`
}

// ---- template-pixel truth: measure text with the browser itself ----
// The old row math estimated wrapped lines by CHAR COUNT (34 chars for the
// remarks cell, 14 for the product cell). Real print does not count chars —
// it paints pixels, and a capitals-heavy remark or a long word overruns the
// estimate: the row is built too short and the NEXT row's figures print over
// the text above ("numbers going over lines", the boss's own words). The
// canvas measures the exact string in the exact font at the exact width, so
// the row height is always the truth of what will print.
let _canvas2d: CanvasRenderingContext2D | null | undefined
function canvas2d(): CanvasRenderingContext2D | null {
  if (_canvas2d === undefined) {
    try { _canvas2d = document.createElement('canvas').getContext('2d') } catch { _canvas2d = null }
  }
  return _canvas2d
}
const SHEET_FONT = `13.5px ${SANS}`
const SHEET_FONT_BOLD = `700 13.5px ${SANS}`
const REMARKS_W = 264 // remarks cell: x 239..503
const PRODUCT_W = 107 // product cell: x 116..223
const QUANTITY_W = 97 // quantity cell: x 504..601

// Mirrors the browser's line breaking with overflow-wrap:anywhere: greedy
// words on spaces; a word wider than the box is broken across lines (the
// divs carry overflowWrap:'anywhere' so print and count agree). Counts the
// lines every wrapped paragraph really takes.
function wrappedLines(text: string, font: string, width: number): number {
  const c = canvas2d()
  if (!c) return 0 // SSR / no canvas: caller falls back to the char estimates
  c.font = font
  let total = 0
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) { total += 1; continue }
    let lines = 1
    let cur = 0
    for (const w of words) {
      const wW = c.measureText(w).width
      if (wW > width) {
        // a monster word: it breaks mid-word, taking ceil spans of the box
        if (cur > 0) { lines += 1; cur = 0 }
        lines += Math.ceil(wW / width) - 1
        cur = wW - Math.floor(wW / width) * width
        continue
      }
      const withWord = cur === 0 ? wW : cur + c.measureText(' ').width + wW
      if (withWord <= width) { cur = withWord; continue }
      lines += 1
      cur = wW
    }
    total += lines
  }
  return total
}

// A figure may never cross a rule line. Small figures print on the template's
// own axis (13.5px, exactly like the archive); a figure too wide for its
// column steps down until it fits — a hair smaller is invisible on paper,
// a digit riding over a divider is not. Money digits are never dropped.
function fitFontSize(text: string, availPx: number, sizes: number[], bold = false): number {
  const c = canvas2d()
  if (!c) return sizes[0]
  for (const s of sizes) {
    c.font = `${bold ? '700 ' : ''}${s}px ${SANS}`
    if (c.measureText(text).width <= availPx) return s
  }
  return sizes[sizes.length - 1]
}

function localDateInputValue(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  const p = (x: number) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

function stamp(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function d2(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

// Remark text rules, straight off the boss's archive statement: a multi-line
// remark renders line-per-line with the first line bold ("Invoice revised:"),
// and a waived line keeps its label plain while the waiver tail prints
// struck+underlined ("Content creation: Waive Approved by CEO.").
function RemarkText({ remark, waived }: { remark: string; waived: boolean }) {
  if (waived) {
    const i = remark.indexOf(': ')
    const head = i === -1 ? remark : remark.slice(0, i + 1)
    const tail = i === -1 ? '' : remark.slice(i + 2)
    return (
      <>
        {head}{' '}
        {tail ? <span style={{ textDecoration: 'line-through underline' }}>{tail}</span> : null}
      </>
    )
  }
  const lines = remark.split('\n')
  if (lines.length === 1) return <>{remark}</>
  return (
    <>
      {lines.map((ln, j) => (
        <div key={j}>{j === 0 ? <strong>{ln}</strong> : ln}</div>
      ))}
    </>
  )
}

// ---- the printable sheet: absolute grid replica of the Canva template ----
// className="statement-sheet" is the print hook: globals.css zooms this fixed
// grid onto one A4 sheet and forces the template greys to print exact.
// Exported for the print-fidelity test (scripts/printtest) only.
export function StatementSheet({ account, now }: { account: Account; now: string }) {
  const entries = [...account.entries].sort((a, b) => +new Date(a.date) - +new Date(b.date))
  // As-at law (the boss's call): the statement prints EVERYTHING up to print
  // day. A line added minutes ago is on the paper — the sheet can never lag
  // the book. Future-dated lines stay off (not yet real, not on the client's
  // paper). The "For the Month" label spans the rows it actually carries,
  // exactly like the archive's own "Apr - Aug 2026".
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const opening = account.balanceBfwd
  const rows = entries
    .filter((e) => +new Date(e.date) <= +endOfToday)
    .map((e) => ({ ...e, running: 0 }))
  {
    let run = opening
    for (const r of rows) {
      if (r.kind !== 'WAIVED') run += r.amount
      r.running = run
    }
  }
  const due = rows.length ? rows[rows.length - 1].running : opening
  // The generated Balance B/f row only exists when the account carries a real
  // opening balance; the archive's own B/f line is a ledger entry and prints
  // as a normal row.
  const hasBfRow = Math.abs(opening) >= 0.005
  // The month the sheet talks about: the last row's month (or today's when the
  // sheet is empty). Drives both the range label and the charges line.
  const talk = rows.length ? new Date(rows[rows.length - 1].date) : new Date()
  const monthStart = new Date(talk.getFullYear(), talk.getMonth(), 1)

  // "For the Month": the span of the rows actually carried — first activity
  // month to last, exactly like the archive's own "Apr - Aug 2026".
  const monthLabel = (() => {
    const tail = `${MONTHS[talk.getMonth()].slice(0, 3)} ${talk.getFullYear()}`
    if (!rows.length) return tail
    const first = new Date(rows[0].date)
    const head = MONTHS[first.getMonth()].slice(0, 3)
    if (first.getFullYear() === talk.getFullYear()) return `${head} - ${tail}`
    return `${head} ${first.getFullYear()} - ${tail}`
  })()

  // table geometry (template px): x 93..897, header 612..662, body to 988.
  // The template's body rows are borderless; heights follow the CONTENT —
  // every column's wrap is counted (a long remark, a product like "Kloof
  // Street Membership" that wraps in its 107px cell, a long quantity), then
  // the rows are fitted into the body: padding breathes while there is room
  // (the archive's 8 rows land on the template's own ~37px) and shrinks to a
  // floor when the book is fuller. A book that truly outgrows the body grows
  // the table box and pushes the footer down — text integrity first, the
  // paper template look second, never a number printed across a line.
  const LINE_H = 17.6 // 13.5px × 1.3
  const PAD_MIN = 5
  const PAD_MAX = 26
  const BODY_BASE = 324 // 376 box − 50 header − border hair
  // remarks cell: 264px of 13.5px ≈ 34 chars a line; explicit \n always breaks
  const lineCount = (t: string) => {
    const parts = t.split('\n').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return 1
    return parts.reduce((acc, p) => acc + Math.max(1, Math.ceil(p.length / 34)), 0)
  }
  const productLines = (p: string | null) => (p ? Math.max(1, Math.ceil(p.length / 14)) : 0) // product cell 107px bold
  // Row truth: count the lines each cell REALLY wraps to (browser-measured;
  // the char counts above are only the no-canvas fallback). The tallest cell
  // sets the row — undercount a line and the next row's figures print over
  // this row's text: the exact "numbers going over lines" the boss saw.
  const measurable = !!canvas2d()
  const linesFor = (remarks: string, product: string | null, quantity: string | null) =>
    Math.max(
      1,
      measurable ? wrappedLines(remarks, SHEET_FONT, REMARKS_W) : lineCount(remarks),
      product ? (measurable ? wrappedLines(product, SHEET_FONT_BOLD, PRODUCT_W) : productLines(product)) : 0,
      quantity ? (measurable ? wrappedLines(quantity, SHEET_FONT, QUANTITY_W) : 1) : 0,
    )
  const allRows: { key: string; date: Date; product: string | null; remarks: string; quantity: string | null; amount: number; kind: string; running: number; lines: number; bf: boolean }[] = []
  if (hasBfRow) {
    allRows.push({ key: 'bf', date: monthStart, product: null, remarks: 'Balance B/f', quantity: null, amount: opening, kind: 'BFWD', running: opening, lines: 1, bf: true })
  }
  for (const r of rows) {
    allRows.push({ key: r.id, date: new Date(r.date), product: r.product, remarks: r.remarks, quantity: r.quantity, amount: r.amount, kind: r.kind, running: r.running, lines: linesFor(r.remarks, r.product, r.quantity), bf: false })
  }
  const nRows = allRows.length
  const linesH = allRows.reduce((acc, r) => acc + r.lines * LINE_H, 0)
  let BODY = BODY_BASE
  let pad = 12
  if (nRows > 0) {
    if (linesH + nRows * PAD_MIN <= BODY_BASE) {
      pad = Math.min(PAD_MAX, (BODY_BASE - linesH) / nRows)
    } else {
      BODY = linesH + nRows * PAD_MIN
      pad = PAD_MIN
    }
  }
  const GROW = Math.max(0, BODY - BODY_BASE)
  const rowH = allRows.map((r) => r.lines * LINE_H + pad)
  const rowTop: number[] = []
  {
    let acc = 50
    for (const h of rowH) {
      rowTop.push(acc)
      acc += h
    }
  }

  return (
    <div
      className="statement-print-page"
      style={GROW > 0 ? { height: 'auto' } : undefined}
    >
    <div className="statement-sheet" style={{ width: 1004, height: 1418 + GROW, position: 'relative', background: '#fff', fontFamily: SANS, color: INK }}>
      <img src="/brand/band.png" alt="" style={{ position: 'absolute', top: 0, left: 0, width: 1004, height: 94 }} />
      <img src="/brand/logo.png" alt="Business Hustle" style={{ position: 'absolute', top: 180, left: 171, width: 71, height: 88 }} />

      {/* title */}
      <div style={{ position: 'absolute', top: 88, left: 496, width: 373, textAlign: 'center', fontSize: 27, fontWeight: 700 }}>Statement</div>

      {/* entity / address / telephone box — values vertically centred per the
          template (entity ~8, address ~20, tel ~14) */}
      {[
        { t: 123, h: 53, vt: 8, label: ['Entity'], lines: ['Simple Eternity Holdings (Pty) Ltd', '2017/652523/07'] },
        { t: 176, h: 112, vt: 20, label: ['Address'], lines: ['99 Kloof Street', 'Gardens.', 'Western Cape', '8001'] },
        { t: 288, h: 50, vt: 14, label: ['Telephone', 'number'], lines: ['+27 21 422 5140'] },
      ].map((r, i) => (
        <div key={i} style={{ position: 'absolute', top: r.t, left: 524, width: 373, height: r.h, border: `1.5px solid ${BOX}`, borderTop: i === 0 ? `1.5px solid ${BOX}` : 'none' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 103, height: '100%', background: GRAY, borderRight: `1.5px solid ${BOX}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, lineHeight: 1.3, textAlign: 'center', padding: '0 4px' }}>
            {r.label.map((l, j) => <span key={j}>{l}</span>)}
          </div>
          <div style={{ position: 'absolute', top: r.vt, left: 110, fontSize: 13.5, lineHeight: '18px' }}>
            {r.lines.map((l, j) => <div key={j}>{l}</div>)}
          </div>
        </div>
      ))}

      {/* client block — template pitch is a tight ~21px line */}
      <div style={{ position: 'absolute', top: 352, left: 100, fontSize: 15.5 }}>{account.clientName}</div>
      <div style={{ position: 'absolute', top: 380, left: 100, fontSize: 15.5, lineHeight: '21px' }}>
        {account.address ? <div>{account.address}</div> : null}
        {account.email ? <div>{account.email}</div> : null}
        {account.website ? <div>{account.website}</div> : null}
        {account.phone ? <div>{account.phone}</div> : null}
      </div>

      {/* meta box */}
      <div style={{ position: 'absolute', top: 358, left: 524, width: 373, height: 129, border: `1.5px solid ${BOX}` }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: 103, height: 40, background: GRAY, borderRight: `1.5px solid ${BOX}`, borderBottom: `1.5px solid ${BOX}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, lineHeight: 1.3, textAlign: 'center' }}>
          <span>Account Ref</span><span>No</span>
        </div>
        <div style={{ position: 'absolute', top: 0, left: 103, width: 141, height: 40, borderBottom: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5 }}>{account.refNo}</div>
        <div style={{ position: 'absolute', top: 0, left: 244, width: 68, height: 40, background: GRAY, borderRight: `1.5px solid ${BOX}`, borderBottom: `1.5px solid ${BOX}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 10, lineHeight: 1.25, textAlign: 'center', padding: '0 1px' }}>
          <span>Recipient VAT</span><span>No</span>
        </div>
        <div style={{ position: 'absolute', top: 0, left: 312, width: 61, height: 40, borderBottom: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{account.recipientVat || ''}</div>
        <div style={{ position: 'absolute', top: 40, left: 0, width: 103, height: 40, background: GRAY, borderRight: `1.5px solid ${BOX}`, borderBottom: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, textAlign: 'center' }}>For the Month</div>
        <div style={{ position: 'absolute', top: 40, left: 103, width: 141, height: 40, borderBottom: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5 }}>{monthLabel}</div>
        <div style={{ position: 'absolute', top: 40, left: 244, width: 68, height: 40, background: GRAY, borderRight: `1.5px solid ${BOX}`, borderBottom: `1.5px solid ${BOX}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 10, lineHeight: 1.25, textAlign: 'center', padding: '0 1px' }}>
          <span>Recipient Reg</span><span>No</span>
        </div>
        <div style={{ position: 'absolute', top: 40, left: 312, width: 61, height: 40, borderBottom: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5 }}>{account.recipientReg || ''}</div>
        <div style={{ position: 'absolute', top: 90, left: 0, width: '100%', height: 39 }}>
          <div style={{ position: 'absolute', top: 10, left: 8, fontSize: 14.5 }}>Charges Generated for {MONTHS[talk.getMonth()]} {talk.getFullYear()}</div>
        </div>
      </div>

      {/* queries box */}
      <div style={{ position: 'absolute', top: 510, left: 524, width: 373, height: 67, border: `1.5px solid ${BOX}` }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: 103, height: '100%', background: GRAY, borderRight: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5 }}>Queries</div>
        <div style={{ position: 'absolute', top: 15, left: 110, fontSize: 13.5, color: LINK, textDecoration: 'underline' }}>accounts@businesshustle.co.za</div>
        <div style={{ position: 'absolute', top: 38, left: 110, fontSize: 13.5 }}>Tel: 021 422 5140</div>
      </div>

      {/* statement created — must clear the table top at 612: two 14px lines
          starting at 580 end at 608. width 340 (not the box's full 373) keeps
          the stamp on the template's measured right axis, 33px inside x 897,
          same as every right-anchored figure on the sheet. */}
      <div style={{ position: 'absolute', top: 580, left: 524, width: 340, textAlign: 'right', fontSize: 12.5, lineHeight: '14px'}}>
        <div>Statement Created, On:</div>
        <div>{now}</div>
      </div>

      {/* main table — amounts sit on the axes measured off the boss's archive
          statement: Total values LEFT-anchored 30px inside their column, Amount
          Due values right-anchored 33px inside the box's right border (the
          archive measures ~32-37px there — 13px was riding the line), Amount
          Due header LEFT-anchored 14px, Quantity/Total headers right at 10px,
          left columns in at 16px. Nothing touches a line. */}
      <div style={{ position: 'absolute', top: 612, left: 93, width: 804, height: 376 + GROW, border: `1.5px solid ${BOX}` }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 50, background: GRAY, borderBottom: `1.5px solid ${BOX}` }} />
        {[
          { x: 0, w: 100, t: 'Date', a: 'left' },
          { x: 100, w: 123, t: 'Product', a: 'left' },
          { x: 223, w: 281, t: 'Remarks', a: 'left' },
          { x: 504, w: 97, t: 'Quantity', a: 'right' },
          { x: 601, w: 103, t: 'Total', a: 'right' },
          { x: 704, w: 100, t: 'Amount Due', a: 'left' },
        ].map((h, i) => (
          <div key={i} style={{
            position: 'absolute', top: 0, left: h.x, width: h.w, height: 50,
            display: 'flex', alignItems: 'center', justifyContent: h.a === 'left' ? 'flex-start' : 'flex-end',
            paddingLeft: h.a === 'left' ? (h.x === 704 ? 14 : 16) : 0, paddingRight: h.a === 'right' ? 10 : 0,
            fontSize: 14.5, borderBottom: `1.5px solid ${BOX}`,
          }}>{h.t}</div>
        ))}
        {[100, 223, 504, 601, 704].map((x, i) => (
          <div key={i} style={{ position: 'absolute', top: 0, left: x, width: 1.5, height: '100%', background: BOX }} />
        ))}
        {/* running-account lines, template-style: borderless, height follows
            the remark (the archive's 3-line invoice row gets room to breathe) */}
        {allRows.map((r, i) => {
          const textTop = Math.max(6, Math.round((rowH[i] - r.lines * LINE_H) / 2))
          // Column laws (template px): Total sits at x 631 with the divider at
          // 704 → 71px of room; Amount Due right-anchors 33px inside the box
          // border (right edge 771) with the same divider at 704 → 64px of
          // room. A wider figure steps down a size instead of riding the line.
          const totalTxt = `R ${Math.abs(r.amount).toFixed(2)}`
          const dueTxt = fmtPlain(r.running)
          return (
            <div key={r.key} style={{ position: 'absolute', top: rowTop[i], left: 0, width: '100%', height: rowH[i] }}>
              <div style={{ position: 'absolute', top: textTop, left: 16, fontSize: 13.5 }}>{d2(r.date)}</div>
              {r.product && !r.bf ? <div style={{ position: 'absolute', top: textTop, left: 116, fontSize: 13.5, fontWeight: 700, maxWidth: 107, overflowWrap: 'anywhere' }}>{r.product}</div> : null}
              <div style={{ position: 'absolute', top: textTop, left: 239, fontSize: 13.5, maxWidth: 264, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {r.bf ? 'Balance B/f' : <RemarkText remark={r.remarks} waived={r.kind === 'WAIVED'} />}
              </div>
              {r.quantity ? <div style={{ position: 'absolute', top: textTop, left: 504, width: 97, textAlign: 'center', fontSize: 13.5, overflowWrap: 'anywhere' }}>{r.quantity}</div> : null}
              {/* Total keeps the template's own voice: "R 4500.00" raw, no
                  thousands separator; waived lines print struck for the record */}
              <div style={{ position: 'absolute', top: textTop, left: 631, fontSize: fitFontSize(totalTxt, 71, [13.5, 12.5, 11.5, 10.5]), textDecoration: r.kind === 'WAIVED' ? 'line-through' : undefined }}>{totalTxt}</div>
              <div style={{ position: 'absolute', top: textTop, right: 33, fontSize: fitFontSize(dueTxt, 64, [13.5, 12.5, 11.5, 10.5]) }}>{dueTxt}</div>
            </div>
          )
        })}
      </div>

      {/* return portion — every top below the table shifts when a full book
          grew the body, so the footer travels WITH the table, never under it */}
      <div style={{ position: 'absolute', top: 995 + GROW, left: 440, fontSize: 13.5, fontWeight: 700 }}>PLEASE RETURN THIS PORTION WITH PROOF OF YOUR PAYMENT TO:</div>
      <div style={{ position: 'absolute', top: 1016 + GROW, left: 440, fontSize: 13.5 }}>accounts@businesshustle.co.za</div>

      {/* arrears slip */}
      <div style={{ position: 'absolute', top: 1043 + GROW, left: 468, width: 429, height: 70, border: `1.5px solid ${BOX}` }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: 127, height: '100%', background: GRAY, borderRight: `1.5px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5 }}>Arrears(-)</div>
        <div style={{ position: 'absolute', top: 0, right: 33, height: '100%', display: 'flex', alignItems: 'center', fontSize: 13.5 }}>{fmtPlain(due)}</div>
      </div>
      <div style={{ position: 'absolute', top: 1112 + GROW, left: 456, width: 447, height: 4, background: BOX }} />

      {/* amount due */}
      <div style={{ position: 'absolute', top: 1128 + GROW, left: 605, width: 163, textAlign: 'right', fontSize: 13.5, lineHeight: 1.3 }}>Amount<br />Due</div>
      <div style={{ position: 'absolute', top: 1120 + GROW, left: 783, width: 114, height: 56, border: `2px solid ${BOX}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fitFontSize(`R ${fmtPlain(due)}`, 108, [16.5, 15, 13.5, 12], true), fontWeight: 700 }}>
        R {fmtPlain(due)}
      </div>
      <div style={{ position: 'absolute', top: 1176 + GROW, left: 768, width: 135, height: 4, background: BOX }} />

      {/* bank block */}
      <div style={{ position: 'absolute', top: 1044 + GROW, left: 100, fontSize: 13.5, lineHeight: '17px' }}>
        <div>Account Name: Simple Eternity Holdings (Pty) Ltd</div>
        <div>t/a Business Hustle Ltd ©</div>
        <div>Bank: Tyme Bank Business Account</div>
        <div>Account No: 530 000 691 98</div>
        <div>Branch Code: 678 910</div>
      </div>
      <div style={{ position: 'absolute', top: 1140 + GROW, left: 100, fontSize: 13.5, fontWeight: 700, lineHeight: '18px' }}>
        <div>PLEASE USE YOUR ACCOUNT NUMBER AS</div>
        <div>REFERENCE WHEN MAKING PAYMENT.</div>
      </div>
      <div style={{ position: 'absolute', top: 1186 + GROW, left: 100, fontSize: 13.5 }}>All payments accepted without prejudice to our rights.</div>

      {/* footer */}
      <img src="/brand/footer_logo.png" alt="" style={{ position: 'absolute', top: 1238 + GROW, left: 437, width: 137, height: 69 }} />
      <div style={{ position: 'absolute', top: 1334 + GROW, left: 100, fontSize: 16 }}>Simple Eternity Holdings (Pty) Ltd</div>
    </div>
    </div>
  )
}

// The as-at law and the month label, shared by the printable sheet AND the
// email draft — one computation, the paper and the email can never disagree.
export function statementMeta(account: Account): { due: number; monthLabel: string } {
  const entries = [...account.entries].sort((a, b) => +new Date(a.date) - +new Date(b.date))
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const rows = entries.filter((e) => +new Date(e.date) <= +endOfToday)
  let run = account.balanceBfwd
  for (const r of rows) { if (r.kind !== 'WAIVED') run += r.amount }
  const talk = rows.length ? new Date(rows[rows.length - 1].date) : new Date()
  const tail = `${MONTHS[talk.getMonth()].slice(0, 3)} ${talk.getFullYear()}`
  let monthLabel = tail
  if (rows.length) {
    const first = new Date(rows[0].date)
    const head = MONTHS[first.getMonth()].slice(0, 3)
    monthLabel = first.getFullYear() === talk.getFullYear() ? `${head} - ${tail}` : `${head} ${first.getFullYear()} - ${tail}`
  }
  return { due: run, monthLabel }
}

function firstNameOf(clientName: string): string {
  return clientName.split('|')[0].trim().split(/\s+/)[0] || 'there'
}

function statementEmailBody(a: Account, m: { due: number; monthLabel: string }): string {
  return [
    `Hi ${firstNameOf(a.clientName)},`,
    '',
    'Please find your statement of account attached (PDF).',
    '',
    `Balance currently due: R ${fmtPlain(m.due)}`,
    `Account ref: ${a.refNo} · statement runs ${m.monthLabel}`,
    '',
    'Banking details for EFT:',
    '  Bank: Tyme Bank Business Account',
    '  Account No: 530 000 691 98',
    '  Branch Code: 678 910',
    `  Please use ${a.refNo} as your payment reference.`,
    '',
    'Any queries, just reply to this email or write to accounts@businesshustle.co.za.',
    '',
    'Kind regards,',
    'Simple Eternity Holdings (Pty) Ltd',
  ].join('\n')
}

export default function StatementsView() {
  const { toast } = useToast()
  const { bumpRefresh } = useHp()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  // Delete-account gate: the dialog makes the boss spell the ref no back.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  // Email-statement state: the draft is generated, then it is ALL his to edit
  // before anything sends (a statement never leaves without his Send).
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailAttach, setEmailAttach] = useState<{ filename: string; content: string; sizeBytes: number } | null>(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailSending, setEmailSending] = useState(false)

  // The lead bridge: after a statement email lands, the book asks ONE honest
  // question — move the matching lead to Won, pin the email to their timeline
  // (with read tracking), or add them as a brand-new lead when nobody matched.
  // Nothing writes until the boss taps; two matches = no guess, just told so.
  const [leadPrompt, setLeadPrompt] = useState<null | {
    kind: 'ONE' | 'NONE' | 'AMBIGUOUS'
    lead?: { id: string; company: string; contactName: string | null; stage: string }
    emailLogId: string
    clientName: string
    email: string
  }>(null)
  const [leadBusy, setLeadBusy] = useState(false)
  const hiddenRef = useRef<HTMLDivElement>(null)
  const [hiddenAccount, setHiddenAccount] = useState<Account | null>(null)
  const [hiddenNow, setHiddenNow] = useState('')

  const [refNo, setRefNo] = useState('')
  const [clientName, setClientName] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [phone, setPhone] = useState('')
  const [balanceBfwd, setBalanceBfwd] = useState('')

  const [lineDate, setLineDate] = useState('')
  const [lineProduct, setLineProduct] = useState('')
  const [lineRemarks, setLineRemarks] = useState('')
  const [lineQty, setLineQty] = useState('')
  const [lineAmount, setLineAmount] = useState('')

  useEffect(() => { setMounted(true) }, [])

  async function load() {
    try {
      const r = await api<{ accounts: Account[]; seeded: boolean }>('/api/statements')
      setAccounts(r.accounts)
      setSelectedId((cur) => cur || r.accounts[0]?.id || null)
    } catch (e) {
      setAccounts([])
      toast({ title: 'Could not load the statement book', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    }
  }
  useEffect(() => { load() }, [])

  const selected = accounts?.find((a) => a.id === selectedId) || null

  async function toggleAutoSync(a: Account) {
    setBusy(true)
    try {
      const r = await api<{ autoSync: boolean }>(`/api/statements/${a.id}`, { method: 'PATCH', body: JSON.stringify({ autoSync: !a.autoSync }) })
      toast({ title: r.autoSync ? 'Auto-invoices on ✓' : 'Auto-invoices off', description: r.autoSync ? `Sent and paid invoices for ${a.clientName} now land on ${a.refNo} automatically.` : 'Nothing books itself on this statement anymore.' })
      await load()
    } catch (e) {
      toast({ title: 'Could not change auto-sync', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id)
    setLineDate(localDateInputValue(e.date))
    setLineProduct(e.product || '')
    setLineRemarks(e.remarks)
    setLineQty(e.quantity || '')
    setLineAmount(String(e.amount))
  }

  function cancelEdit() {
    setEditingId(null)
    setLineDate(''); setLineProduct(''); setLineRemarks(''); setLineQty(''); setLineAmount('')
  }

  async function saveEdit() {
    if (!selected || !editingId) return
    if (!lineRemarks.trim() || !lineAmount.trim()) {
      toast({ title: 'A line needs a remark and an amount', description: 'Positive to bill the client, negative for a payment received.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; unlinked?: boolean }>(`/api/statements/${selected.id}?entry=${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: lineDate || localDateInputValue(new Date()),
          product: lineProduct,
          remarks: lineRemarks,
          quantity: lineQty,
          amount: Number(lineAmount),
        }),
      })
      toast({ title: 'Line updated ✓', description: r.unlinked ? 'Saved. It no longer follows its invoice — your correction is the record now.' : undefined })
      cancelEdit()
      await load()
    } catch (e) {
      toast({ title: 'Could not update the line', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function createAccount() {
    if (!refNo.trim() || !clientName.trim()) {
      toast({ title: 'Two fields are required', description: 'Account ref (e.g. BVS-0999-06) and the client name.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const r = await api<{ id: string; refNo?: string }>('/api/statements', { method: 'POST', body: JSON.stringify({ refNo, clientName, address, email, website, phone, balanceBfwd: Number(balanceBfwd) || 0 }) })
      toast({ title: 'Account opened ✓', description: `${r.refNo || refNo.toUpperCase()} is in the book.` })
      setRefNo(''); setClientName(''); setAddress(''); setEmail(''); setWebsite(''); setPhone(''); setBalanceBfwd('')
      setShowCreate(false)
      await load()
    } catch (e) {
      toast({ title: 'Could not open the account', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addLine() {
    if (!selected) return
    if (editingId) return saveEdit()
    if (!lineRemarks.trim() || !lineAmount.trim()) {
      toast({ title: 'A line needs a remark and an amount', description: 'Positive to bill the client, negative for a payment received.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await api(`/api/statements/${selected.id}`, {
        method: 'POST',
        body: JSON.stringify({
          date: lineDate || new Date().toISOString().slice(0, 10),
          product: lineProduct,
          remarks: lineRemarks,
          quantity: lineQty,
          amount: Number(lineAmount),
        }),
      })
      toast({ title: 'Line added ✓' })
      setLineDate(''); setLineProduct(''); setLineRemarks(''); setLineQty(''); setLineAmount('')
      await load()
      bumpRefresh()
    } catch (e) {
      toast({ title: 'Could not add the line', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function removeLine(entryId: string) {
    if (!selected) return
    setBusy(true)
    try {
      await api(`/api/statements/${selected.id}?entry=${entryId}`, { method: 'DELETE' })
      toast({ title: 'Line removed' })
      await load()
    } catch (e) {
      toast({ title: 'Could not remove the line', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function closeAccount() {
    if (!selected) return
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; refNo: string }>(`/api/statements/${selected.id}?confirm=${encodeURIComponent(deleteConfirm.trim())}`, { method: 'DELETE' })
      toast({ title: 'Account deleted ✓', description: `${r.refNo} and its lines are off the book. The invoices themselves are untouched.` })
      setDeleteOpen(false)
      setDeleteConfirm('')
      setSelectedId(null)
      await load()
    } catch (e) {
      toast({ title: 'Could not delete the account', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // Build the statement PDF from the REAL printable sheet — the same DOM the
  // printer gets, captured at natural size — then open the email draft. The
  // PDF is pixel-identical to the print preview by construction: one sheet,
  // one truth.
  async function startEmailStatement() {
    if (!selected) return
    setEmailBusy(true)
    try {
      const meta = statementMeta(selected)
      const filename = `Statement-${selected.refNo}-${meta.monthLabel.replace(/\s+/g, '')}.pdf`
      setHiddenAccount(selected)
      setHiddenNow(stamp())
      await new Promise((r) => setTimeout(r, 80)) // let React commit the sheet
      const el = hiddenRef.current?.querySelector('.statement-sheet') as HTMLElement | null
      if (!el) throw new Error('The statement sheet did not render.')
      const imgs = Array.from(el.querySelectorAll('img'))
      await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth > 0 ? null : new Promise<void>((res) => { im.onload = () => res(); im.onerror = () => res() }))))
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 595.28, 841.89)
      const content = (pdf.output('datauristring') || '').split(',')[1] || ''
      if (!content) throw new Error('The PDF came out empty.')
      setEmailAttach({ filename, content, sizeBytes: Math.floor(content.length * 0.75) })
      setEmailTo(selected.email || '')
      setEmailSubject(`Statement of account — ${selected.refNo} — ${meta.monthLabel}`)
      setEmailBody(statementEmailBody(selected, meta))
      setEmailOpen(true)
    } catch (e) {
      toast({ title: 'Could not build the statement PDF', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally {
      setHiddenAccount(null)
      setEmailBusy(false)
    }
  }

  async function sendStatementEmail() {
    if (!emailTo.trim().includes('@')) {
      toast({ title: 'Add the client\'s email', description: 'The statement needs a valid address to go to.', variant: 'destructive' })
      return
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast({ title: 'Subject and message are required', description: 'Edit the draft however you like, but keep both.', variant: 'destructive' })
      return
    }
    setEmailSending(true)
    try {
      const res = await api<{ email: { id: string }; leadMatch?: { kind: 'NONE' | 'ONE' | 'AMBIGUOUS'; lead?: { id: string; company: string; contactName: string | null; stage: string } } }>('/api/emails', {
        method: 'POST',
        body: JSON.stringify({
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          body: emailBody,
          attachments: emailAttach ? [{ filename: emailAttach.filename, content: emailAttach.content }] : undefined,
          matchLead: true,
          leadName: selected?.clientName || '',
        }),
      })
      toast({ title: 'Statement emailed ✓', description: `${emailAttach ? emailAttach.filename : 'No PDF attached'} → ${emailTo.trim()}. A copy sits in your Mail log.` })
      setEmailOpen(false)
      // The pipeline gets its chance to hear about it — the boss decides.
      if (res.leadMatch && selected) {
        setLeadPrompt({
          kind: res.leadMatch.kind,
          lead: res.leadMatch.kind === 'ONE' ? res.leadMatch.lead : undefined,
          emailLogId: res.email.id,
          clientName: selected.clientName,
          email: emailTo.trim(),
        })
      }
    } catch (e) {
      toast({ title: 'The email did not go out', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setEmailSending(false) }
  }

  // One tap on the prompt → one atomic write on the lead side. The door does
  // the work; this just honest-toasts the outcome.
  async function applyLeadUpdate() {
    if (!leadPrompt) return
    setLeadBusy(true)
    try {
      if (leadPrompt.kind === 'ONE' && leadPrompt.lead) {
        const was = leadPrompt.lead.stage !== 'WON'
        await api('/api/statements/lead-update', {
          method: 'POST',
          body: JSON.stringify({ emailLogId: leadPrompt.emailLogId, leadId: leadPrompt.lead.id, moveToWon: was }),
        })
        toast({
          title: 'Lead updated ✓',
          description: was
            ? `${leadPrompt.lead.company} moved to Won, with the statement on their timeline (read tracking on).`
            : `The statement now sits on ${leadPrompt.lead.company}'s lead timeline (read tracking on).`,
        })
      } else if (leadPrompt.kind === 'NONE') {
        await api('/api/statements/lead-update', {
          method: 'POST',
          body: JSON.stringify({ emailLogId: leadPrompt.emailLogId, create: { company: leadPrompt.clientName, email: leadPrompt.email } }),
        })
        toast({ title: 'Lead added ✓', description: `${leadPrompt.clientName} is in your pipeline in Won — next month's statement finds them on its own.` })
      }
      bumpRefresh()
      setLeadPrompt(null)
    } catch (e) {
      toast({ title: 'Could not update the lead', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' })
    } finally { setLeadBusy(false) }
  }

  function printStatement() {
    if (!selected) return
    setNow(stamp())
    setPrintOpen(true)
    setTimeout(() => window.print(), 350)
  }

  // Portal print law (mirrors the invoice sheet): announce on body, portal to
  // document.body, the globals.css law hides the entire app on print.
  useEffect(() => {
    if (!printOpen) return
    document.body.classList.add('statement-printing')
    return () => document.body.classList.remove('statement-printing')
  }, [printOpen])

  if (accounts === null) {
    return <div className="p-6 text-sm text-muted-foreground">Opening the statements book…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Statements</h2>
          <p className="text-sm text-muted-foreground">
            The Simple Eternity Holdings billing book — monthly client statements straight from the template. Internal only.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowCreate((s) => !s)}>
          <Plus className="h-4 w-4" /> Open an account
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Account ref no *</label>
              <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="BVS-0999-06" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">Client name | Company *</label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Kim Tucker | Bodyvision Studio" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Physical address</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="2nd Floor, Lifestyle Centre" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@email.com" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Website</label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.co.za" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 ..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Balance B/f (opening)</label>
              <Input value={balanceBfwd} onChange={(e) => setBalanceBfwd(e.target.value)} placeholder="0.00" inputMode="decimal" />
            </div>
          </div>
          <Button onClick={createAccount} disabled={busy}>Open account</Button>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          The book is empty. Open an account to start statementing.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`rounded-xl border px-4 py-3 text-left transition ${a.id === selectedId ? 'border-brand bg-brand/10' : 'bg-card hover:bg-accent/40'}`}
            >
              <div className="font-semibold text-sm">{a.refNo}</div>
              <div className="text-xs text-muted-foreground">{a.clientName}</div>
              <div className="text-xs mt-1">Balance: <span className={a.balance > 0 ? 'font-semibold text-amber-600' : 'font-semibold text-emerald-600'}>{fmtPlain(a.balance)}</span></div>
              <div
                role="button"
                tabIndex={0}
                onClick={(ev) => { ev.stopPropagation(); if (selectedId === a.id) toggleAutoSync(a) }}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); if (selectedId === a.id) toggleAutoSync(a) } }}
                className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${a.autoSync ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-muted text-muted-foreground hover:bg-accent/40'}`}
                title="When on, invoices you send or mark paid for this client land on this statement automatically. Lines already on the book are never touched."
              >
                <Link2 className="h-3 w-3" /> Auto-invoices: {a.autoSync ? 'On' : 'Off'}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button onClick={printStatement} className="gap-2">
              <Printer className="h-4 w-4" /> Print statement
            </Button>
            <Button variant="outline" onClick={startEmailStatement} disabled={emailBusy} className="gap-2">
              {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email statement
            </Button>
            <p className="text-xs text-muted-foreground max-w-md">
              Prints everything up to today — a line you added minutes ago is on the paper. Template-exact: in the print dialog, choose Save as PDF and send it.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDeleteConfirm(''); setDeleteOpen(true) }}
              disabled={busy}
              className="ml-auto shrink-0 gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
              title="Removes this account and every line on it. Asks you to type the ref no first."
            >
              <Trash2 className="h-4 w-4" /> Delete account
            </Button>
          </div>

          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Remarks</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {selected.entries.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No lines yet — add the first one below.</td></tr>
                )}
                {selected.entries.map((e) => (
                  <tr key={e.id} className={`border-b last:border-0 ${editingId === e.id ? 'bg-brand/10' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-ZA')}</td>
                    <td className="px-3 py-2 break-words">{e.product || '—'}</td>
                    <td className="px-3 py-2 break-words whitespace-pre-line">{e.remarks}</td>
                    <td className="px-3 py-2">{e.quantity || ''}</td>
                    <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${e.amount < 0 ? 'text-emerald-600' : ''}`}>{fmtPlain(e.amount)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.kind}
                      {e.sourceRef?.startsWith('invoice:') ? <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="This line follows its invoice — edit it to take it over."><Link2 className="h-3 w-3" />linked</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => (editingId === e.id ? cancelEdit() : startEdit(e))} disabled={busy} className="mr-2 text-muted-foreground hover:text-foreground" aria-label="Edit line">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => removeLine(e.id)} disabled={busy} className="text-muted-foreground hover:text-destructive" aria-label="Remove line">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {editingId ? 'Edit line' : 'Add a line'}
              {editingId ? (
                <Button size="sm" variant="ghost" onClick={cancelEdit} className="ml-auto h-7 px-2 text-xs">Cancel editing</Button>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-6">
              <div>
                <label className="text-xs text-muted-foreground">Date</label>
                <Input type="date" value={lineDate} onChange={(e) => setLineDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Product</label>
                <Input value={lineProduct} onChange={(e) => setLineProduct(e.target.value)} placeholder="Membership" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Remarks *</label>
                <Input value={lineRemarks} onChange={(e) => setLineRemarks(e.target.value)} placeholder="kloofstreet.online - November 2026" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Qty</label>
                <Input value={lineQty} onChange={(e) => setLineQty(e.target.value)} placeholder="1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Amount (+ bill / − payment)</label>
                <Input value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} placeholder="-150" inputMode="decimal" />
              </div>
            </div>
            <Button onClick={addLine} disabled={busy}>{editingId ? 'Save changes' : 'Add line'}</Button>
          </div>
        </div>
      )}

      {/* off-screen: the REAL printable sheet, mounted only while the PDF is
          being built — the email attachment is the print, byte for byte */}
      {hiddenAccount && (
        <div ref={hiddenRef} aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: 1004, pointerEvents: 'none', background: '#fff' }}>
          <StatementSheet account={hiddenAccount} now={hiddenNow || stamp()} />
        </div>
      )}

      {/* email-statement draft: generated, then ALL the boss's — nothing
          leaves until he presses Send himself (the no-auto-send law) */}
      {selected && (
        <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Email statement — {selected.refNo}</DialogTitle>
              <DialogDescription>
                The draft below is yours to edit — nothing sends until you press Send. The PDF rides along as an attachment.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">To</label>
                <Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@email.com" />
                {!selected.email && (
                  <p className="text-[11px] text-muted-foreground">This account has no email on file — type where the statement must go.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Subject</label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Message</label>
                <Textarea rows={12} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                {emailAttach ? (
                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs min-w-0">
                    <FileText className="h-3.5 w-3.5 text-brand shrink-0" />
                    <span className="truncate">{emailAttach.filename}</span>
                    <span className="text-muted-foreground shrink-0">{(emailAttach.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                    <button onClick={() => setEmailAttach(null)} aria-label="Remove PDF" className="text-muted-foreground hover:text-foreground shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No PDF attached — press Email statement again to rebuild it.</span>
                )}
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
                  <Button onClick={sendStatementEmail} disabled={emailSending} className="gap-2">
                    {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* the lead bridge: one honest question after the statement lands —
          nothing writes until the boss taps */}
      {selected && (
        <Dialog open={!!leadPrompt} onOpenChange={(o) => { if (!o) setLeadPrompt(null) }}>
          <DialogContent className="sm:max-w-md">
            {leadPrompt?.kind === 'ONE' && leadPrompt.lead && (
              <>
                <DialogHeader>
                  <DialogTitle>Update the lead?</DialogTitle>
                  <DialogDescription>
                    Statement emailed to {leadPrompt.email}. {leadPrompt.lead.company} is in your pipeline
                    as {STAGES.find((s) => s.key === leadPrompt.lead?.stage)?.label || leadPrompt.lead.stage}.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {leadPrompt.lead.stage !== 'WON'
                      ? `Update lead moves ${leadPrompt.lead.company} to Won and pins this email to their lead timeline — you'll see when they read it.`
                      : `This pins the email to ${leadPrompt.lead.company}'s lead timeline — you'll see when they read it.`}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setLeadPrompt(null)}>Not now</Button>
                    <Button onClick={applyLeadUpdate} disabled={leadBusy} className="gap-2">
                      {leadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Update lead
                    </Button>
                  </div>
                </div>
              </>
            )}
            {leadPrompt?.kind === 'NONE' && (
              <>
                <DialogHeader>
                  <DialogTitle>Add {leadPrompt.clientName} as a lead?</DialogTitle>
                  <DialogDescription>
                    Statement emailed to {leadPrompt.email}, but nobody by that name is in your pipeline yet.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Add lead puts {leadPrompt.clientName} in Won with this email on their timeline — next
                    month's statement finds them on its own.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setLeadPrompt(null)}>Not now</Button>
                    <Button onClick={applyLeadUpdate} disabled={leadBusy} className="gap-2">
                      {leadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add lead
                    </Button>
                  </div>
                </div>
              </>
            )}
            {leadPrompt?.kind === 'AMBIGUOUS' && (
              <>
                <DialogHeader>
                  <DialogTitle>Which lead is it?</DialogTitle>
                  <DialogDescription>
                    More than one lead matches {leadPrompt.clientName}. I don't guess — open Leads and update
                    the right one yourself.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setLeadPrompt(null)}>OK</Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* delete-account gate: the book carries money history, so it asks for
          the ref no spelled back — on purpose or not at all */}
      {selected && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {selected.refNo}?</DialogTitle>
              <DialogDescription>
                This removes the account for {selected.clientName} and every line on it
                ({selected.entries.length} line{selected.entries.length === 1 ? '' : 's'}, balance R {fmtPlain(selected.balance)}).
                The invoices themselves are untouched. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Type {selected.refNo} to confirm</label>
                <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={selected.refNo} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>Keep the account</Button>
                <Button variant="destructive" onClick={closeAccount} disabled={busy || deleteConfirm.trim().toUpperCase() !== selected.refNo.trim().toUpperCase()} className="gap-2">
                  <Trash2 className="h-4 w-4" /> Delete account
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {printOpen && selected && mounted && createPortal(
        <div id="statement-print-root" className="fixed inset-0 z-[60] bg-black/70 overflow-auto p-4 print:static print:bg-white print:p-0 print:z-auto">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-black/80 text-white px-4 py-2 print:hidden">
            <p className="text-sm">Statement preview — {selected.refNo}, everything up to today. Choose Save as PDF in the print dialog.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => window.print()} className="gap-2"><Printer className="h-4 w-4" /> Print / Save PDF</Button>
              <Button size="sm" variant="outline" onClick={() => setPrintOpen(false)} className="gap-2"><X className="h-4 w-4" /> Close</Button>
            </div>
          </div>
          <div className="flex justify-center py-6 print:py-0">
            <div className="statement-preview-wrap shadow-2xl print:shadow-none">
              <StatementSheet account={selected} now={now || stamp()} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
