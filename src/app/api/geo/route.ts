import { NextRequest, NextResponse } from 'next/server'
import { currencyForCountry } from '@/lib/currency'

/**
 * GET /api/geo, the visitor's country as proven by the edge (Vercel injects
 * x-vercel-ip-country). Unknown or missing header means we CANNOT prove the
 * visitor is abroad, so the answer is South Africa and Rand, always.
 */
export function GET(req: NextRequest) {
  const country = (req.headers.get('x-vercel-ip-country') || 'ZA').toUpperCase()
  return NextResponse.json(
    { country, currency: currencyForCountry(country) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
