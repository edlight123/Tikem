import { NextResponse } from 'next/server'
import { isValidSeatHoldReleaseToken, releaseSeatHold } from '@/lib/tickets/seatHolds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/checkout/release-hold  { holdId, releaseToken }
 *
 * The buyer closed the payment sheet: put their held seats back on sale now
 * instead of when the hold expires. Authorization is the release token, an
 * HMAC of the hold id that the checkout route returned ONLY to the client that
 * started this checkout (lib/tickets/seatHolds.ts): a hold id on its own, from
 * a log or a guess, releases nothing. Only a HOLD is ever released — a seat
 * that was already paid for (converted to a sale) is never touched, so a late
 * call after a successful payment is harmless.
 */
export async function POST(request: Request) {
  let holdId: unknown = null
  let releaseToken: unknown = null
  try {
    const body = await request.json()
    holdId = body?.holdId
    releaseToken = body?.releaseToken
  } catch {
    // An empty or non-JSON body releases nothing.
  }
  if (!isValidSeatHoldReleaseToken(holdId, releaseToken)) {
    return NextResponse.json({ released: false }, { status: 403 })
  }
  const released = await releaseSeatHold(holdId, { logPrefix: '[release-hold]' })
  return NextResponse.json({ released })
}
