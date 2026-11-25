// Backfill `funds_rail` (where a sale's money physically sits) onto tickets,
// stripe_orders and pending_transactions written before 2026-11-24.
//
// NOT REQUIRED: every report reads the rail through resolveFundsRail
// (lib/payouts/funds-rail.ts), which infers it from the fields old docs carry.
// This only stores the inferred value so ad-hoc Firestore queries can filter
// on it.
//
// DRY RUN BY DEFAULT. It prints what it would write, per collection and rail.
//
//   node scripts/backfill-funds-rail.mjs            preview (writes nothing)
//   node scripts/backfill-funds-rail.mjs --write    write
//
// Only docs WITHOUT a valid funds_rail are touched, and only the funds_rail
// field is written (merge). A doc no rule can place is left alone and listed.
// Idempotent: a second run finds nothing to do.
//
// The inference below MIRRORS resolveFundsRail in lib/payouts/funds-rail.ts
// (a script cannot import the TypeScript module). Keep the two in step.
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const env = readFileSync('/Users/tedjacquet/Tikem/.env.local', 'utf8')
const line = env.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='))
let raw = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim()
if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) })
const db = admin.firestore()

const WRITE = process.argv.includes('--write')

const RAILS = new Set(['moncash', 'sogepay', 'stripe_platform', 'stripe_connect', 'paypal', 'cash', 'free'])
const FREE = new Set(['free', 'comp', 'complimentary', 'rsvp', 'guest_list'])
const CASH = new Set(['pay_at_door', 'cash', 'door', 'door_cash'])
const MONCASH = new Set(['moncash', 'natcash', 'moncash_button', 'mobile_money'])
const STRIPE = new Set(['stripe', 'card', 'stripe_platform'])

const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0

function fromMethod(method, destination) {
  const m = String(method ?? '').toLowerCase().trim()
  if (!m) return null
  if (FREE.has(m)) return 'free'
  if (CASH.has(m)) return 'cash'
  if (MONCASH.has(m)) return 'moncash'
  if (m === 'sogepay') return 'sogepay'
  if (m === 'paypal') return 'paypal'
  if (m === 'stripe_connect') return 'stripe_connect'
  if (STRIPE.has(m)) return destination ? 'stripe_connect' : 'stripe_platform'
  return null
}

function infer(doc) {
  if (RAILS.has(doc.funds_rail)) return doc.funds_rail
  const destination =
    Boolean(doc.stripe_connect_account_id || doc.stripeConnectAccountId || doc.transfer_destination) ||
    String(doc.payout_provider ?? doc.payoutProvider ?? '').toLowerCase() === 'stripe_connect'
  const m = fromMethod(doc.payment_method ?? doc.paymentMethod ?? doc.method, destination)
  if (m) return m
  const source = String(doc.source ?? '').toLowerCase().trim()
  if (source === 'comp' || source === 'guest_list') return 'free'
  const paid = positive(doc.price_paid ?? doc.pricePaid ?? doc.price) || positive(doc.charged_amount) || positive(doc.amount)
  if (!paid) return 'free'
  const ref = String(doc.payment_intent_id || doc.payment_id || doc.paymentIntentId || '').trim()
  if (ref.startsWith('pi_') || ref.startsWith('cs_')) return destination ? 'stripe_connect' : 'stripe_platform'
  return null
}

async function run(collection) {
  const counts = {}
  const unplaced = []
  let pending = []
  let written = 0
  let last = null
  for (;;) {
    let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      const data = d.data() || {}
      if (RAILS.has(data.funds_rail)) continue
      const rail = infer(data)
      if (!rail) {
        unplaced.push(d.id)
        continue
      }
      counts[rail] = (counts[rail] || 0) + 1
      pending.push({ ref: d.ref, rail })
    }
    last = snap.docs[snap.docs.length - 1]
    if (WRITE && pending.length >= 400) {
      const batch = db.batch()
      for (const p of pending) batch.set(p.ref, { funds_rail: p.rail }, { merge: true })
      await batch.commit()
      written += pending.length
      pending = []
    }
  }
  if (WRITE && pending.length) {
    const batch = db.batch()
    for (const p of pending) batch.set(p.ref, { funds_rail: p.rail }, { merge: true })
    await batch.commit()
    written += pending.length
  }
  console.log(`\n${collection}: ${WRITE ? 'wrote' : 'would write'}`, counts, WRITE ? `(${written} docs)` : '')
  if (unplaced.length) {
    console.log(`  ${unplaced.length} could not be placed (left alone):`, unplaced.slice(0, 20).join(', '), unplaced.length > 20 ? '…' : '')
  }
}

console.log(WRITE ? 'WRITING funds_rail' : 'DRY RUN (pass --write to write)')
for (const c of ['tickets', 'stripe_orders', 'pending_transactions']) {
  await run(c)
}
process.exit(0)
