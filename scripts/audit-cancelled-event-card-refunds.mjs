// Read-only: which already-cancelled events have PAID CARD tickets that were
// never refunded?
//
// Before the fix, lib/events/cancel.ts read `ticket.price` and
// `ticket.payment_intent_id`, but every Stripe purchase path writes `price_paid`
// and `payment_id`. So for a card ticket the price read as 0 (voided as "free",
// no refund) or, failing that, the sale fell through to the MonCash manual
// queue. Either way Stripe was never called.
//
// This lists, per cancelled event, every card ticket (payment_method stripe /
// stripe_connect / card, or a `pi_` payment_id) with money on it whose ticket
// doc does not show a completed refund, plus the manual_refund_queue entry if
// one exists. With a Stripe key in .env.local it also asks Stripe (GET only)
// whether the PaymentIntent has any refund, since an admin may have refunded
// from the dashboard.
//
// NEVER writes: Firestore is only read with .get(); Stripe only with list/retrieve.
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'
const env = readFileSync('/Users/tedjacquet/Tikem/.env.local','utf8')
const envVar = (name) => {
  const line = env.split('\n').find(l=>l.startsWith(`${name}=`))
  if (!line) return null
  let v = line.slice(name.length + 1).trim()
  if ((v.startsWith("'")&&v.endsWith("'"))||(v.startsWith('"')&&v.endsWith('"'))) v=v.slice(1,-1)
  return v
}
let raw = envVar('FIREBASE_SERVICE_ACCOUNT_KEY')
admin.initializeApp({credential:admin.credential.cert(JSON.parse(raw))})
const db=admin.firestore()

const stripeKey = envVar('STRIPE_SECRET_KEY')
let stripe = null
if (stripeKey) {
  try {
    const Stripe = (await import('stripe')).default
    stripe = new Stripe(stripeKey)
  } catch (e) {
    console.log('(stripe SDK unavailable, skipping Stripe cross-check)', e?.message)
  }
}

const CARD_METHODS = new Set(['stripe','stripe_connect','card'])
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

const eventsSnap = await db.collection('events').where('status','==','cancelled').get()
console.log(`cancelled events: ${eventsSnap.size}`)
console.log(`stripe cross-check: ${stripe ? (stripeKey.startsWith('sk_live') ? 'LIVE key' : 'TEST key') : 'off'}\n`)

let totalCard = 0
let totalUnrefunded = 0
const unrefundedByCurrency = {}

for (const ev of eventsSnap.docs) {
  const e = ev.data()
  const ticketsSnap = await db.collection('tickets').where('event_id','==',ev.id).get()
  const cardTickets = ticketsSnap.docs.filter((d) => {
    const t = d.data()
    const method = String(t.payment_method || '').toLowerCase()
    const ref = String(t.payment_id || t.payment_intent_id || '')
    return CARD_METHODS.has(method) || ref.startsWith('pi_')
  }).filter((d) => {
    const t = d.data()
    return num(t.charged_amount) > 0 || num(t.price_paid ?? t.price) > 0
  })

  const rows = []
  for (const d of cardTickets) {
    const t = d.data()
    totalCard += 1
    const refunded = String(t.status||'').toLowerCase() === 'refunded' && String(t.refund_status||'').toLowerCase() === 'approved' && t.refund_id
    if (refunded) continue

    const pi = String(t.payment_id || t.payment_intent_id || '')
    let queue = null
    const q = await db.collection('manual_refund_queue').where('ticketId','==',d.id).get()
    if (!q.empty) queue = q.docs.map((x)=>x.data().status || '?').join(',')

    let stripeRefunded = null
    if (stripe && pi.startsWith('pi_')) {
      try {
        const list = await stripe.refunds.list({ payment_intent: pi, limit: 100 })
        stripeRefunded = list.data.filter((r)=>r.status !== 'failed' && r.status !== 'canceled').reduce((s,r)=>s+r.amount,0) / 100
      } catch (err) {
        stripeRefunded = `error: ${err?.message?.slice(0,60)}`
      }
    }

    const amount = num(t.charged_amount) || num(t.price_paid ?? t.price)
    const currency = String((num(t.charged_amount) ? t.charged_currency : t.currency) || '?').toUpperCase()
    totalUnrefunded += 1
    unrefundedByCurrency[currency] = (unrefundedByCurrency[currency] || 0) + amount
    rows.push({
      ticket: d.id,
      method: t.payment_method || '-',
      status: t.status || '-',
      refund_status: t.refund_status ?? '-',
      amount: `${amount} ${currency}`,
      price_paid: t.price_paid ?? '-',
      pi: pi || '-',
      queue: queue || '-',
      stripe_refunded: stripeRefunded ?? '-',
    })
  }

  const cancelledAt = e.cancelled_at || '-'
  console.log(`event ${ev.id}  "${e.title || ''}"  cancelled_at=${cancelledAt}  tickets=${ticketsSnap.size}  paid card tickets=${cardTickets.length}  not refunded=${rows.length}`)
  if (rows.length) console.table(rows)
}

console.log(`\nTOTAL paid card tickets on cancelled events: ${totalCard}`)
console.log(`TOTAL without a recorded Stripe refund:      ${totalUnrefunded}`)
for (const [c,a] of Object.entries(unrefundedByCurrency)) console.log(`  ${c}: ${Math.round(a*100)/100}`)
process.exit(0)
