'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, ShieldCheck, ArrowLeft, CircleCheck } from 'lucide-react'

/**
 * /remove-listing, the public POPIA opt-out for businesses.
 * A listed business asks once; the suppression goes live within a minute
 * and the team confirms at the contact given. No account required.
 */
export default function RemoveListingPage() {
  const [business, setBusiness] = useState('')
  const [city, setCity] = useState('')
  const [contact, setContact] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/delist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business, city, contact, reason }),
      })
      const json = (await res.json()) as { ok?: boolean; message?: string; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error || 'Something went wrong. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-display text-xl tracking-wide">
            HUSTLE<span className="text-brand">PORTAL</span>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back to HustlePortal
          </a>
        </div>
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-brand" />
              Privacy &amp; POPIA · listing removal
            </div>
            <h1 className="font-display text-3xl">Remove my business</h1>
            <p className="text-muted-foreground">
              If your business appears in the HustlePortal lead index and you want it out,
              this is the direct path. One request is enough: your listing leaves the index
              within the hour, it stops appearing in every search, and it is never revealed
              to paying users again.
            </p>
          </div>

          {done ? (
            <Card>
              <CardContent className="p-6 md:p-8 space-y-4 text-center">
                <CircleCheck className="h-9 w-9 text-brand mx-auto" />
                <p className="text-sm font-medium">Request received.</p>
                <p className="text-sm text-muted-foreground">
                  Your listing leaves the lead index within the hour. The team will confirm
                  at the contact you gave. If anything else is needed, email{' '}
                  <a href="mailto:ceo@businesshustle.co.za" className="text-brand hover:underline">ceo@businesshustle.co.za</a>.
                </p>
                <Button variant="outline" onClick={() => { setDone(false); setBusiness(''); setCity(''); setContact(''); setReason('') }}>
                  Remove another listing
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 md:p-8 space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="d-biz">Business name</Label>
                    <Input
                      id="d-biz"
                      placeholder="Exactly as it appears in the listing"
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-city">City or suburb</Label>
                    <Input
                      id="d-city"
                      placeholder="e.g. Gardens, Cape Town"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-contact">Your email or phone</Label>
                  <Input
                    id="d-contact"
                    placeholder="you@business.co.za or 072 000 0000"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used only to confirm the removal with you. Nothing is marketed to you.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-reason">Anything we should know? (optional)</Label>
                  <Input
                    id="d-reason"
                    placeholder="e.g. We are closed down, or we never agreed to be listed"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" role="alert">{error}</p>
                )}
                <Button
                  onClick={submit}
                  disabled={busy || business.trim().length < 2 || contact.trim().length < 6}
                  className="w-full h-11 text-base font-semibold"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Request removal'}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Your request is handled under our{' '}
                  <a href="https://businesshustle.co.za/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                    Privacy &amp; POPIA notice
                  </a>
                  . You can also ask the Information Officer directly at ceo@businesshustle.co.za.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="border-t">
        <div className="max-w-2xl mx-auto px-6 py-4 text-[11px] text-muted-foreground">
          HustlePortal · Simple Eternity Holdings (Pty) Ltd · Cape Town, South Africa
        </div>
      </footer>
    </div>
  )
}
