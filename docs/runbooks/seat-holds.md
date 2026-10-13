# Seat holds and sharded inventory: runbook

Code: `lib/tickets/inventoryShards.ts` (capacity gate), `lib/tickets/seatHolds.ts`
(holds at checkout start), `/api/cron/inventory-sweep` (expiry + counter rollup).

## Before the first deploy

1. **Vercel env:** set `SEAT_HOLD_SECRET` (any long random string) in Production
   and Preview. It signs the token that lets a client release its own hold.
   Without it the code falls back to other secrets, which works but couples
   them. Optional: `SEAT_HOLD_MINUTES` (default 8), `SEAT_HOLD_MAX_PER_BUYER`
   (default 3), `SEAT_HOLD_MAX_PER_IP` (guests only, default 100).
2. **Stripe webhook:** subscribe the endpoint to `payment_intent.canceled`.
   Without it a canceled PaymentIntent's hold simply expires after 8 minutes.
3. **Firestore indexes:** `firebase deploy --only firestore:indexes` applies the
   `inventory_shards` field exemptions (`h`, `b` are never queried; indexing
   their per-hold map entries only costs index entries and write latency).
4. Check the cron `/api/cron/inventory-sweep` (every 2 min) appears in Vercel.

## After a rollback (or if sold counts look wrong)

Code that predates the shards writes `events.tickets_sold` /
`ticket_tiers.sold_quantity` directly. On an event that already has shards those
writes are invisible to the capacity gate, and the next rollup overwrites them.
After rolling forward again, re-seed every event that sold during the rollback:

```
npx tsx scripts/reseed-inventory-shards.ts <eventId>           # dry run: prints before / after
npx tsx scripts/reseed-inventory-shards.ts <eventId> --apply   # writes, then rolls the counters up
```

It recounts live tickets (valid | confirmed | active) per event and tier, keeps
live seat holds, and re-levels the shard allocations for the current capacities.
If the recount is above capacity, nothing more sells until it is back under.

`scripts/fix-tickets-sold.ts` and `POST /api/admin/fix-tickets-sold` now SKIP
sharded events (they would be overwritten by the next rollup); use the reseed
script for those.

## What to watch

- `busy_try_again` (503) at checkout start: contention outlasted the retries.
  A few during an on-sale rush are expected; many means the event needs more
  shards (the count is fixed when its shards are first created:
  `events.inventory_shards_n`, ceil(capacity / 25) clamped to 20..100).
- MonCash / SogePay orders answered `confirming`: paid, seats not yet
  confirmed. The buyer waits on `/purchase/processing`; the reconcile cron
  finishes the order. Nothing to do unless one stays pending past an hour.
- `too_many_holds` (429): a buyer (3 live holds or 50 held seats per event) or a
  guest network (100 live holds per event) hit its cap. Holds free on release,
  conversion or expiry.
