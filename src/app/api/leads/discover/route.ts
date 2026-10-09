import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { searchLeads } from '@/lib/explee'

// POST /api/leads/discover — source leads via Explee (or demo mode)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { definition, city, limit } = await req.json()
  if (!definition || !String(definition).trim()) {
    return NextResponse.json({ error: 'Describe who you want to sell to.' }, { status: 400 })
  }
  const result = await searchLeads(
    String(definition).trim(),
    city || undefined,
    Math.min(Math.max(parseInt(limit) || 10, 1), 30)
  )
  return NextResponse.json(result)
}
