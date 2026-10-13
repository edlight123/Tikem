/**
 * Re-seed an event's seat-inventory shards from its LIVE tickets.
 *
 * When: after a rollback to code that predates the inventory shards (that code
 * moves `tickets_sold` / `sold_quantity` directly, behind the shards' back), or
 * whenever the shards' sold counts are believed wrong. See
 * docs/runbooks/seat-holds.md.
 *
 * Counts the event's tickets whose status holds a seat (valid | confirmed |
 * active), overall and per tier, and makes the shards' sold counts equal them
 * (lib/tickets/inventoryShards.ts reseedInventoryShards). Live seat holds are
 * kept; allocations are re-levelled for the current capacities.
 *
 * DRY RUN by default: prints before / after and writes nothing.
 *
 *   npx tsx scripts/reseed-inventory-shards.ts <eventId>            # dry run
 *   npx tsx scripts/reseed-inventory-shards.ts <eventId> --apply    # write
 */

import 'dotenv/config'
import { adminDb } from '../lib/firebase/admin'
import { reseedInventoryShards, rollupInventoryCounters } from '../lib/tickets/inventoryShards'

const LIVE = new Set(['valid', 'confirmed', 'active'])

async function main() {
  const eventId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!eventId || eventId.startsWith('--')) {
    console.error('Usage: npx tsx scripts/reseed-inventory-shards.ts <eventId> [--apply]')
    process.exit(1)
  }

  const [tickets, tiers] = await Promise.all([
    adminDb.collection('tickets').where('event_id', '==', eventId).get(),
    adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get(),
  ])
  let event = 0
  const perTier: Record<string, number> = {}
  for (const doc of tiers.docs) perTier[doc.id] = 0
  for (const doc of tickets.docs) {
    const t = doc.data() || {}
    if (!LIVE.has(String(t.status || '').toLowerCase())) continue
    event += 1
    const tierId = String(t.tier_id || '')
    if (tierId && tierId in perTier) perTier[tierId] += 1
  }

  const result = await reseedInventoryShards(eventId, { event, tiers: perTier }, { dryRun: !apply })
  console.log(`Event ${eventId}: ${result.shards} shards`)
  console.log('  shards sold before:', result.before)
  console.log('  sold from live tickets:', result.after)
  if (!apply) {
    console.log('\nDry run: nothing written. Re-run with --apply to write.')
    return
  }
  await rollupInventoryCounters(eventId)
  console.log('\nWritten, and tickets_sold / sold_quantity rolled up from the shards.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Reseed failed:', err)
    process.exit(1)
  })
