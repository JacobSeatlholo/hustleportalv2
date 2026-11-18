'use client'

// ============ MEMBER TESTIMONIAL WALL — main site (Task 219) ============
// Sits beside the Google reviews block on the landing: approved member stories
// (served only after the desk's yes) plus the submit form so visitors can add
// their own. Nothing renders publicly before a human approval.

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import TestimonialForm from '@/components/hp/TestimonialForm'

type Row = {
  id: string
  name: string
  business: string | null
  location: string | null
  body: string
  rating: number
  createdAt: string
}

export default function MemberTestimonials() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    fetch('/api/testimonials')
      .then((r) => r.json())
      .then((j) => setRows(Array.isArray(j?.testimonials) ? j.testimonials : []))
      .catch(() => setRows([]))
  }, [])

  return (
    <section id="member-stories" className="space-y-6">
      <div>
        <div className="hp-eyebrow text-brand">Member stories</div>
        <h2 className="font-display text-3xl md:text-4xl mt-2">Told by the people living it</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every story below was submitted here and approved by the team. Yours can join them.
        </p>
      </div>
      {rows && rows.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          {rows.slice(0, 6).map((r) => (
            <figure key={r.id} className="rounded-xl border bg-card p-5 flex flex-col gap-3">
              <div className="flex gap-0.5" aria-label={`Rated ${r.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className={`h-3.5 w-3.5 ${i <= r.rating ? 'fill-brand text-brand' : 'text-muted-foreground/40'}`} />
                ))}
              </div>
              <blockquote className="text-sm leading-relaxed">“{r.body}”</blockquote>
              <figcaption className="mt-auto">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {[r.business, r.location].filter(Boolean).join(' · ') || 'Member'}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          No member stories on the wall yet. Be the first below.
        </div>
      )}
      <div className="rounded-2xl border bg-card p-6 space-y-4">
        <div>
          <p className="font-semibold text-sm">Tell your story</p>
          <p className="text-xs text-muted-foreground">
            Did the verified leads move your business? Two or three honest sentences help the next
            person decide.
          </p>
        </div>
        <TestimonialForm />
      </div>
    </section>
  )
}
