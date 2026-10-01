// One-off repair for "La vie en Versace" (RuC5dUSdkPRFOoEZqvEw), approved by
// the owner on 2026-09-30. The old delete-and-reinsert tier save left its 3
// tickets pointing at deleted tiers and its current tiers at sold_quantity 0.
// This re-points each orphaned ticket at the current tier with the same name
// and restores each tier's sold count. Dry run by default; pass --apply.
//
//   node scripts/repair-orphaned-tier-tickets.mjs           # show the plan
//   node scripts/repair-orphaned-tier-tickets.mjs --apply   # write it
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const EVENT_ID = 'RuC5dUSdkPRFOoEZqvEw'
const apply = process.argv.includes('--apply')

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
let raw = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY=')).slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const tiers = await db.collection('ticket_tiers').where('event_id', '==', EVENT_ID).get()
const liveIds = new Set(tiers.docs.map((d) => d.id))
const tierByName = new Map(tiers.docs.map((d) => [d.data().name, d]))
const tickets = await db.collection('tickets').where('event_id', '==', EVENT_ID).get()

const now = new Date().toISOString()
const batch = db.batch()
const soldByTier = new Map()
let writes = 0

// Count every ticket that already points at a live tier, too, so the restored
// sold_quantity is the true total rather than just the orphans.
for (const t of tickets.docs) {
  const d = t.data()
  let tierId = d.tier_id
  if (!liveIds.has(tierId)) {
    const target = tierByName.get(d.tier_name)
    if (!target) {
      console.error(`ticket ${t.id}: no current tier named "${d.tier_name}" — aborting`)
      process.exit(1)
    }
    console.log(`ticket ${t.id}: tier_id ${tierId} → ${target.id} (${d.tier_name})`)
    batch.update(t.ref, { tier_id: target.id, tier_id_repaired_from: tierId, updated_at: now })
    writes++
    tierId = target.id
  }
  soldByTier.set(tierId, (soldByTier.get(tierId) || 0) + 1)
}

for (const [tierId, sold] of soldByTier) {
  const tier = tiers.docs.find((d) => d.id === tierId)
  const current = Number(tier.data().sold_quantity || 0)
  if (current === sold) continue
  console.log(`tier ${tier.data().name}: sold_quantity ${current} → ${sold}`)
  batch.update(tier.ref, { sold_quantity: sold, updated_at: now })
  writes++
}

if (writes === 0) {
  console.log('Nothing to repair.')
  process.exit(0)
}
if (!apply) {
  console.log(`\n${writes} writes planned. Re-run with --apply to write them.`)
  process.exit(0)
}
await batch.commit()
console.log(`\nCommitted ${writes} writes.`)
process.exit(0)
