'use client'
/**
 * useCurrency, fetches the visitor's proven country once per page load and
 * returns a price formatter. Defaults to ZAR while unknown, so a South African
 * can never even momentarily see a dollar figure.
 */
import { useEffect, useState } from 'react'
import { formatPrice, conversionNote, type Currency } from '@/lib/currency'

let cached: { country: string; currency: Currency } | null = null

export function useCurrency() {
  const [geo, setGeo] = useState<{ country: string; currency: Currency }>(
    cached || { country: 'ZA', currency: 'ZAR' },
  )

  useEffect(() => {
    if (cached) return
    fetch('/api/geo')
      .then((r) => r.json())
      .then((d: { country: string; currency: Currency }) => {
        cached = d
        setGeo(d)
      })
      .catch(() => { /* default ZAR stands */ })
  }, [])

  return {
    country: geo.country,
    currency: geo.currency,
    /** ZAR cents → display price in the visitor's currency. */
    price: (centsZar: number) => formatPrice(centsZar, geo.currency),
    isLocal: geo.currency === 'ZAR',
    note: conversionNote(geo.currency),
  }
}
