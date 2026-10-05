import { NextResponse } from 'next/server'

/**
 * RETIRED. Batch payouts were retired in commit bf02e5c9 ("retire batch payout").
 *
 * This route flipped a failed `organizers/{uid}/payouts/{id}` doc back to
 * 'pending' with a new scheduled date, which would revive a payout that no
 * longer runs through any current engine, outside the withdrawal gate
 * (lib/payouts/withdrawal-gate.ts) and the release rules. It had no callers.
 * Organizers now request money through /api/organizer/withdraw-bank and
 * /api/organizer/withdraw-moncash; admins act on failed payouts in /admin/money.
 *
 * Kept as an explicit 410 rather than deleted so any stale client gets a clear
 * answer instead of a 404 that looks like a deploy problem.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Payout retry has been retired. Request a new withdrawal from your earnings page instead.',
      code: 'retired',
    },
    { status: 410 }
  )
}
