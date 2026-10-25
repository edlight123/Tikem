import { NextResponse } from 'next/server'
import { sweepInventory } from '@/lib/tickets/inventoryShards'
import { sweepWaitlists } from '@/lib/waitlist'

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
    console.info('[inventory_sweep] run complete', { ...result, waitlist })
    return NextResponse.json({ ok: true, ...result, waitlist })
  } catch (error: any) {
    console.error('[inventory_sweep] failed', { message: error?.message })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
