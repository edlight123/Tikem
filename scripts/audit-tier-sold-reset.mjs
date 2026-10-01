// Read-only: which ticket tiers had their sold count wiped by an edit?
//
// Until 2026-09-30 both composers REPLACED an event's whole tier set on every
// save: every ticket_tiers doc deleted, fresh ones inserted with
// sold_quantity: 0. Two kinds of damage follow, and this reports both:
//
//  1. RESET COUNTERS: a live tier whose sold_quantity is below the number of
//     tickets carrying its id. Checkout reads total_quantity - sold_quantity,
//     so these tiers can oversell.
//  2. ORPHANED TICKETS: tickets whose tier_id points at a tier doc that no
//     longer exists (the pre-edit id). Every ticket sold before an edit lands
//     here, and the replacement tier's counter knows nothing about them.
//
// Nothing is written. Usage: node scripts/audit-tier-sold-reset.mjs
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
let raw = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY=')).slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

// Live = valid | confirmed | active (see ticket-status vocabulary). Anything
// refunded / cancelled no longer holds inventory.
const DEAD = new Set(['cancelled', 'canceled', 'refunded', 'void', 'voided', 'expired', 'failed'])
const holdsInventory = (t) => !DEAD.has(String(t.status || '').toLowerCase())
const tierIdOf = (t) => String(t.tier_id || t.tierId || t.ticket_tier_id || '')

const [tierSnap, ticketSnap, eventSnap] = await Promise.all([
  db.collection('ticket_tiers').get(),
  db.collection('tickets').get(),
  db.collection('events').get(),
])
const events = new Map(eventSnap.docs.map((d) => [d.id, d.data()]))
const tiers = new Map(tierSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))

const statusCounts = {}
const byTier = new Map() // tierId -> { holding, all }
const orphanByEvent = new Map() // eventId -> { tickets, tierIds:Set }
let noTierId = 0
for (const d of ticketSnap.docs) {
  const t = d.data()
  const st = String(t.status || '(none)')
  statusCounts[st] = (statusCounts[st] || 0) + 1
  const tid = tierIdOf(t)
  if (!tid) {
    noTierId++
    continue
  }
  const qty = 1 // one ticket doc per admission
  const rec = byTier.get(tid) || { holding: 0, all: 0 }
  rec.all += qty
  if (holdsInventory(t)) rec.holding += qty
  byTier.set(tid, rec)
  if (!tiers.has(tid)) {
    const ev = String(t.event_id || '(no event)')
    const o = orphanByEvent.get(ev) || { tickets: 0, holding: 0, tierIds: new Set() }
    o.tickets++
    if (holdsInventory(t)) o.holding++
    o.tierIds.add(tid)
    orphanByEvent.set(ev, o)
  }
}

console.log(`tiers: ${tiers.size}   tickets: ${ticketSnap.size}   events: ${events.size}`)
console.log(`tickets without any tier id: ${noTierId}`)
console.log('ticket statuses:', JSON.stringify(statusCounts))

// 1. Reset counters.
const reset = []
for (const tier of tiers.values()) {
  const rec = byTier.get(tier.id)
  const sold = Number(tier.sold_quantity || 0)
  if (rec && rec.holding > sold) reset.push({ tier, sold, holding: rec.holding, all: rec.all })
}
reset.sort((a, b) => b.holding - b.sold - (a.holding - a.sold))
console.log(`\n== 1. Tiers whose sold_quantity is below the tickets carrying their id: ${reset.length}`)
for (const r of reset) {
  const ev = events.get(String(r.tier.event_id)) || {}
  const total = Number(r.tier.total_quantity || 0)
  console.log(
    `  ${r.tier.id}  "${r.tier.name}"  event=${r.tier.event_id} "${ev.title || '?'}"  ` +
      `sold_quantity=${r.sold}  tickets=${r.holding} (all statuses ${r.all})  total=${total}` +
      `  active=${r.tier.is_active !== false}${total && r.holding > total ? '  ** OVERSOLD vs total **' : ''}`
  )
}

// 2. Orphaned tickets.
const orphanRows = [...orphanByEvent.entries()].sort((a, b) => b[1].tickets - a[1].tickets)
const orphanTotal = orphanRows.reduce((n, [, o]) => n + o.tickets, 0)
console.log(`\n== 2. Tickets whose tier_id points at a deleted tier: ${orphanTotal} across ${orphanRows.length} event(s)`)
for (const [evId, o] of orphanRows) {
  const ev = events.get(evId) || {}
  const liveTiers = [...tiers.values()].filter((t) => String(t.event_id) === evId)
  const liveSold = liveTiers.reduce((n, t) => n + Number(t.sold_quantity || 0), 0)
  console.log(
    `  event=${evId} "${ev.title || '?'}"  orphaned tickets=${o.tickets} (holding inventory ${o.holding})` +
      `  dead tier ids=${o.tierIds.size}  current tiers=${liveTiers.length} sold_quantity sum=${liveSold}` +
      `  event.tickets_sold=${ev.tickets_sold ?? '?'}`
  )
}
process.exit(0)
