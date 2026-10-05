import { NextResponse } from 'next/server'

/**
 * RETIRED (owner decision, 2026-10-05): the batch "Request payout".
 *
 * Withdrawals are made per event — POST /api/organizer/withdraw-moncash or
 * /api/organizer/withdraw-bank — from each event's earnings page, validated
 * by the shared availability function (lib/payouts/availability.ts). The batch
 * path duplicated that flow across events on a second record of what was paid.
 *
 * Batch payouts filed before retirement (organizers/{id}/payouts) still count:
 * the availability subtracts them, and the admin routes that view, approve,
 * mark paid, decline and cancel them keep working. Production had 0 open
 * (pending/approved) batch payouts at retirement.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Batch payout requests have been retired',
      code: 'batch_payout_retired',
      message:
        "Payouts are now requested per event. Open the event's earnings page (Finance → the event) and withdraw its released funds to MonCash or your bank.",
      withdrawUrl: '/organizer/finance#events-earnings',
    },
    { status: 410 }
  )
}
