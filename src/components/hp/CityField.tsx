'use client'

/**
 * CityField — one consistent "where are you?" input, used everywhere a city is keyed in:
 * signup, profile, Lead Finder, quick capture, service requests.
 *
 * Quick-pick chips + free typing + optional one-tap location tagging (browser geolocation →
 * BigDataCloud reverse geocode, no API key needed). The detected city is only ever a
 * PROPOSAL the user confirms — nothing is stored until the parent form is saved.
 */
import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Check, Loader2, MapPin } from 'lucide-react'

const QUICK_CITIES = ['Johannesburg', 'Durban', 'Pretoria', 'Cape Town', 'Port Elizabeth']

export default function CityField({
  value,
  onChange,
  label = 'City',
  placeholder = 'Type your city, township or suburb…',
  hint = 'Chips are shortcuts — you can type any city, township or suburb, or tag your location.',
  /** Optional: fires with the tagged GPS position (cleared with null when the value is edited). */
  onCoords,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  placeholder?: string
  hint?: string
  onCoords?: (c: { lat: number; lng: number } | null) => void
}) {
  const { toast } = useToast()
  const [locating, setLocating] = useState(false)
  const [proposal, setProposal] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function detect() {
    if (!navigator.geolocation) {
      toast({
        title: 'Location not available',
        description: 'Your browser does not support location — type your city instead.',
        variant: 'destructive',
      })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude.toFixed(4)}&longitude=${pos.coords.longitude.toFixed(4)}&localityLanguage=en`,
            { signal: AbortSignal.timeout(10_000) }
          )
          const data = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string }
          const city = (data.city || data.locality || '').trim()
          onCoords?.(coords)
          if (!city) throw new Error('no city')
          setProposal(
            data.principalSubdivision && !city.includes(data.principalSubdivision)
              ? `${city}, ${data.principalSubdivision}`
              : city
          )
        } catch {
          // Reverse geocode failed, but the GPS fix itself is good — hand the raw
          // coordinates up (Lead Finder searches a 5 km radius around the pin).
          onCoords?.(coords)
          setLocating(false)
          toast({
            title: 'Location tagged',
            description: 'We have your GPS position. If the city name looks wrong, just type it.',
          })
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        toast({
          title: 'Location permission declined',
          description: 'No problem — type your city manually below.',
          variant: 'destructive',
        })
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 }
    )
  }

  return (
    <div className="space-y-1.5">
      {label ? <Label>{label}</Label> : null}
      <div className="flex flex-wrap gap-1">
        {QUICK_CITIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setProposal(null)
              onCoords?.(null)
              onChange(c)
            }}
            className={`text-xs px-2 py-1 rounded-full border transition ${
              value === c
                ? 'bg-brand border-brand text-black font-medium'
                : 'bg-transparent text-muted-foreground hover:border-brand/60'
            }`}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setProposal(null)
            onCoords?.(null)
            if (QUICK_CITIES.includes(value)) onChange('')
            inputRef.current?.focus()
          }}
          className={`text-xs px-2 py-1 rounded-full border transition ${
            value && !QUICK_CITIES.includes(value)
              ? 'bg-brand border-brand text-black font-medium'
              : 'bg-transparent text-muted-foreground hover:border-brand/60'
          }`}
        >
          Other
        </button>
      </div>

      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setProposal(null)
            onCoords?.(null)
            onChange(e.target.value)
          }}
          placeholder={placeholder}
          aria-label={label || 'City'}
          autoComplete="off"
        />
        <Button type="button" variant="outline" size="sm" onClick={detect} disabled={locating} className="shrink-0">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          Tag location
        </Button>
      </div>

      {proposal && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 text-xs">
          <MapPin className="h-3.5 w-3.5 text-brand shrink-0" />
          <span>
            We found <b>{proposal}</b>. Use it?
          </span>
          <div className="flex gap-1.5 ml-auto">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs bg-brand text-black hover:bg-brand/90"
              onClick={() => {
                onChange(proposal)
                setProposal(null)
                toast({ title: `City set to ${proposal}`, description: 'Remember to save the form.' })
              }}
            >
              <Check className="h-3 w-3 mr-1" /> Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setProposal(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
