import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { matchContacts } from '@/lib/firestore/connections'
import { consumeRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Numbers per call. Clients chunk a larger address book into several calls. */
const MAX_PHONES_PER_CALL = 200
/** Numbers per user per day: a real address book fits, a phone-number sweep does not. */
const DAILY_PHONE_BUDGET = 3000
const DAY_MS = 24 * 60 * 60 * 1000

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const phones = body?.phones

    if (!Array.isArray(phones)) {
      return NextResponse.json({ error: 'phones must be an array' }, { status: 400 })
    }

    // Truncate rather than reject so older app builds (which sent the whole
    // address book in one call) still get a partial answer.
    const cleaned = Array.from(
      new Set(phones.filter((p): p is string => typeof p === 'string' && p.length <= 40))
    ).slice(0, MAX_PHONES_PER_CALL)

    if (cleaned.length === 0) return NextResponse.json({ matches: [] })

    const throttle = await consumeRateLimit({
      key: `match-contacts:${user.id}`,
      limit: DAILY_PHONE_BUDGET,
      windowMs: DAY_MS,
      cost: cleaned.length,
    })
    if (throttle.limited) {
      return NextResponse.json(
        { error: 'Too many contact lookups today. Please try again tomorrow.' },
        { status: 429 }
      )
    }

    const matches = await matchContacts(user.id, cleaned)
    return NextResponse.json({ matches })
  } catch (error: any) {
    console.error('Error matching contacts:', error?.message || error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
