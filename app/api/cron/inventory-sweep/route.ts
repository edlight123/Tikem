import { NextResponse } from 'next/server'
import { sweepInventory } from '@/lib/tickets/inventoryShards'

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
    console.info('[inventory_sweep] run complete', result)
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    console.error('[inventory_sweep] failed', { message: error?.message })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
