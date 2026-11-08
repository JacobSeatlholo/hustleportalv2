'use client'

import { useMemo, useState } from 'react'
import { bookingKind } from '@/lib/booking'

/**
 * The guest-side picker island for /book/<slug>. Gold Rush chrome, three
 * breaths: pick a day, pick a free time, say who you are — done, the booking
 * is on the practitioner's calendar and the confirmation lands in your inbox.
 * No account, no app, no phone call.
 */

export interface PickerProps {
  slug: string
  ownerName: string
  title: string
  kind: string
  durationMin: number
  location: string | null
  description: string | null
  logoUrl: string | null
  days: Array<{ date: string; label: string; slots: Array<{ start: string; end: string; label: string }> }>
}

const GOLD = '#f5c518'
const INK = '#14161B'
const ACCENT = '#B8900A'
const TEXT = '#1F2937'
const MUTED = '#857B5E'
const SOFT = '#F8EFD4'

interface BookedResult {
  when: string
  meetLink: string | null
  gcalLink: string
  icsUrl: string
  guestNotified: boolean
}

export default function BookingPicker(p: PickerProps) {
  const kind = bookingKind(p.kind) // unknown / legacy ids read as MEETING
  const [dayIdx, setDayIdx] = useState(0)
  const [slot, setSlot] = useState<{ start: string; label: string } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<BookedResult | null>(null)

  const phoneRequired = kind.id === 'PHONE'
  const phoneOk = !phoneRequired || phone.replace(/\D/g, '').length >= 6

  const day = p.days[dayIdx]
  const totalSlots = useMemo(() => p.days.reduce((n, d) => n + d.slots.length, 0), [p.days])

  async function submit() {
    if (!slot) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/book/${p.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotStart: slot.start, name, email, phone, notes }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'That did not go through. Try another slot.')
        setBusy(false)
        return
      }
      setDone({ when: json.when, meetLink: json.meetLink || null, gcalLink: json.gcalLink, icsUrl: json.icsUrl, guestNotified: json.guestNotified })
    } catch {
      setError('Network hiccup — try again.')
      setBusy(false)
    }
  }

  const inputStyle = {
    width: '100%',
    border: '1px solid #E4DCC4',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    color: TEXT,
    background: '#FFFFFF',
    outline: 'none' as const,
  }

  return (
    <div style={{ background: '#FFFDF7', borderRadius: '0 0 14px 14px', padding: '26px 26px 30px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Owner identity: their logo if they set one, otherwise their initials */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 6 }}>
        {p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.logoUrl} alt={`${p.ownerName} logo`} style={{ width: 46, height: 46, objectFit: 'contain', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E4DCC4', padding: 4 }} />
        ) : (
          <span style={{ width: 46, height: 46, borderRadius: 10, background: SOFT, color: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
            {p.ownerName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2.5, color: ACCENT }}>{kind.icon} {kind.eyebrow}</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: TEXT, lineHeight: 1.25 }}>{p.ownerName} {kind.requestLine}</div>
        </div>
      </div>
      <div style={{ fontSize: 15, color: TEXT, marginTop: 10 }}>
        Book <strong>{p.title}</strong> · {p.durationMin} min
        {p.location ? <> · {p.location}</> : null}
      </div>
      {p.description && <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, margin: '8px 0 0' }}>{p.description}</p>}

      {done ? (
        <div style={{ marginTop: 22 }}>
          <div style={{ background: SOFT, borderRadius: 12, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: ACCENT, letterSpacing: 2 }}>BOOKED ✓</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, marginTop: 6 }}>{done.when}</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>{p.title} · {p.ownerName}{p.location ? ` · ${p.location}` : ''}</div>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>
              It is in {p.ownerName}&apos;s calendar already. A confirmation email is on its way
              {done.guestNotified ? '' : ' (or check your spam folder)'}.
              {kind.id === 'PHONE' ? ` Keep your phone handy — ${p.ownerName} will call the number you left.` : ''}
            </p>
          </div>
          {done.meetLink && (
            <a href={done.meetLink} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 14, background: INK, color: GOLD, fontWeight: 700, fontSize: 15, borderRadius: 9, padding: '13px 30px', textDecoration: 'none' }}>
              🎥 Join the online meeting
            </a>
          )}
          <a href={done.gcalLink} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: done.meetLink ? 10 : 14, background: GOLD, color: INK, fontWeight: 700, fontSize: 15, borderRadius: 9, padding: '13px 30px', textDecoration: 'none' }}>
            Add to Google Calendar
          </a>
          <a href={done.icsUrl} style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 13, color: ACCENT, textDecoration: 'underline' }}>
            Download calendar file (.ics)
          </a>
        </div>
      ) : totalSlots === 0 ? (
        <div style={{ marginTop: 20, background: SOFT, borderRadius: 12, padding: '22px 18px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: TEXT, fontWeight: 700 }}>No open times right now</p>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>
            All published slots are taken or behind you. Message {p.ownerName} directly and ask them to open more availability.
          </p>
        </div>
      ) : (
        <>
          {/* Day chips */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '18px 0 4px', scrollbarWidth: 'thin' }}>
            {p.days.map((d, i) => {
              const on = i === dayIdx
              const dead = d.slots.length === 0
              return (
                <button
                  key={d.date}
                  onClick={() => { setDayIdx(i); setSlot(null) }}
                  disabled={dead}
                  style={{
                    flex: '0 0 auto',
                    border: `1px solid ${on ? GOLD : '#E4DCC4'}`,
                    background: on ? GOLD : dead ? 'transparent' : '#FFFFFF',
                    color: dead ? '#C9C2AE' : on ? INK : TEXT,
                    borderRadius: 8,
                    padding: '7px 11px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: dead ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.label}
                </button>
              )
            })}
          </div>

          {/* Slot grid */}
          <div style={{ marginTop: 12 }}>
            {day && day.slots.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 7 }}>
                {day.slots.map((s) => {
                  const on = slot?.start === s.start
                  return (
                    <button
                      key={s.start}
                      onClick={() => setSlot({ start: s.start, label: s.label })}
                      style={{
                        border: `1px solid ${on ? GOLD : '#E4DCC4'}`,
                        background: on ? GOLD : '#FFFFFF',
                        color: on ? INK : TEXT,
                        borderRadius: 8,
                        padding: '9px 4px',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: MUTED, textAlign: 'center', padding: '14px 0' }}>Nothing free on this day — try another.</p>
            )}
          </div>

          {/* Guest details */}
          {slot && (
            <div style={{ marginTop: 20, borderTop: '1px solid #EFE8D4', paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: ACCENT, letterSpacing: 2, marginBottom: 10 }}>YOUR DETAILS — {day.label} AT {slot.label}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <input style={inputStyle} placeholder="Your name *" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                <input style={inputStyle} type="email" placeholder="Email for your confirmation *" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
                <input style={inputStyle} type="tel" placeholder={phoneRequired ? 'Phone number * — you will be called' : 'Phone (optional)'} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
                <textarea style={{ ...inputStyle, minHeight: 58 }} placeholder={`Anything ${p.ownerName.split(/\s+/)[0]} should know? (optional)`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
              </div>
              {error && <p style={{ fontSize: 13, color: '#C0392B', marginTop: 8 }}>{error}</p>}
              <button
                onClick={submit}
                disabled={busy || name.trim().length < 2 || !email.includes('@') || !phoneOk}
                style={{
                  width: '100%',
                  marginTop: 12,
                  background: GOLD,
                  color: INK,
                  fontWeight: 700,
                  fontSize: 15,
                  border: 'none',
                  borderRadius: 9,
                  padding: '13px 30px',
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: busy || name.trim().length < 2 || !email.includes('@') || !phoneOk ? 0.55 : 1,
                }}
              >
                {busy ? 'Booking…' : `Confirm ${day.label} at ${slot.label}`}
              </button>
              <p style={{ fontSize: 11, color: MUTED, marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
                Times are South African time (SAST). Your name and note go to {p.ownerName} only.
              </p>
            </div>
          )}
        </>
      )}

      <p style={{ fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 22 }}>Booked via HustlePortal — one place to run a hustle.</p>
    </div>
  )
}
