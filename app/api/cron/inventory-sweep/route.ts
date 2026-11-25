import { NextResponse } from 'next/server'
import { sweepInventory } from '@/lib/tickets/inventoryShards'
import { sweepWaitlists } from '@/lib/waitlist'
import { expireUnpaidBatches } from '@/lib/physical/payments'
import { sweepDoorTeam } from '@/lib/doorTeam/payments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Seat-inventory housekeeping (lib/tickets/inventoryShards.ts).
 *
 *  - Expired seat holds are marked expired and pruned from their shard. Their
 *    seats were already back on sale the moment they expired (every capacity
 *    check ignores an expired hold); this only tidies up.
 *  - `events.tickets_sold` / `ticket_tiers.sold_quantity` are rolled up from the
 *    shards for every event with a sale or release the inline rollup skipped
 *    (it is throttled), so the counters pages read catch up within minutes.
 *
 *  - Waitlists (lib/waitlist.ts): every event with people waiting is asked
 *    "can someone buy right now?", and if so its waiting list is emailed,
 *    once per person per release burst. Runs after the hold expiry above, so
 *    seats an expired hold just returned count.
 *
 *  - Printed-ticket batches (lib/physical) still unpaid after their payment
 *    window are cancelled and their seats given back, after one last check
 *    with MonCash / Stripe that the payment did not land.
 *
 *  - Door team requests (lib/doorTeam): quotes past their close are expired
 *    (after one last gateway check), and confirmed crews past their access
 *    window are marked done with their door access removed.
 *
 * Correctness never depends on this job: if it stops, nothing oversells; the
 * display counters just lag until the next sale on that event.
 *
 * Schedule: vercel.json → every 2 minutes.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await sweepInventory({ logPrefix: '[inventory_sweep]' })
    // Never lets a waitlist problem fail the inventory sweep (it does not throw).
    const waitlist = await sweepWaitlists()
    // Never lets a printed-batch problem fail the inventory sweep.
    const physical = await expireUnpaidBatches().catch((err: any) => {
      console.error('[inventory_sweep] printed batch expiry failed', { message: err?.message })
      return null
    })
    const doorTeam = await sweepDoorTeam().catch((err: any) => {
      console.error('[inventory_sweep] door team sweep failed', { message: err?.message })
      return null
    })
    console.info('[inventory_sweep] run complete', { ...result, waitlist, physical, doorTeam })
    return NextResponse.json({ ok: true, ...result, waitlist, physical, doorTeam })
  } catch (error: any) {
    console.error('[inventory_sweep] failed', { message: error?.message })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
