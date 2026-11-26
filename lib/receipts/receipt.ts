/**
 * Buyer receipts: one receipt per paid order (one payment id), ported from
 * Tikra (9c32850b) and adapted to Tikèm's money model.
 *
 * Pure. The model is built from the order's tickets, which already carry what
 * the buyer was charged, in the CHARGED currency (charged_amount incl. any
 * pass-on service fee, buyer_fee_charged_amount = that fee). No FX is
 * recomputed: a receipt shows what the buyer paid.
 *
 *  - Ticket lines are grouped by tier at the face the buyer paid for them.
 *  - Add-ons ride on the order's FIRST ticket (lib/addons/addOns.ts): that
 *    ticket's charged_amount includes them, and buyer_fee_charged_amount
 *    includes their fee share, so they come out of its face here and get
 *    their own lines ("T-shirt (M) × 2").
 *  - The service fee is the buyer-paid (pass-on) fee only. Under organizer
 *    incidence the buyer paid face value and there is no fee line: the fee was
 *    the organizer's (lib/payouts/availability.ts).
 *  - Printed (physical) tickets, pay-at-the-door, free and comp tickets have
 *    price_paid 0 / no charge: no money passed through Tikèm, so no receipt.
 *  - Amounts print through lib/money.ts, so HTG never shows decimals.
 *  - A Haiti event's receipt is French with 12-hour times (lib/datetime/eventClock).
 */
import crypto from 'crypto'
import { escapeHtml } from '@/lib/html'
import { formatMoneyFromCents } from '@/lib/money'
import { addOnLabel, ticketAddOns } from '@/lib/addons/addOns'
import { resolveFundsRail } from '@/lib/payouts/funds-rail'
import { intlLocaleFor } from '@/lib/dateLocale'
import { formatEventDateTime, ticketDateLine } from '@/lib/datetime/eventClock'
import { RECEIPT_LABELS, receiptLang, type ReceiptLabels, type ReceiptLang } from './labels'

export const TIKEM_SUPPORT_EMAIL = 'support@tikem.co'

export interface ReceiptTicket {
  id: string
  [k: string]: any
}

export interface ReceiptEvent {
  title?: string | null
  start_datetime?: any
  venue_name?: string | null
  city?: string | null
  country?: string | null
  timezone?: string | null
}

export interface ReceiptInput {
  paymentId: string
  tickets: ReceiptTicket[]
  event: ReceiptEvent | null
  organizerName: string | null
}

export interface ReceiptLine {
  kind: 'ticket' | 'addon'
  label: string
  quantity: number
  /** Per unit, charged currency, minor units (tickets only; 0 for add-ons). */
  unitMinor: number
  amountMinor: number
}

export type PaidWith = keyof ReceiptLabels['rails']

export interface ReceiptModel {
  orderId: string
  orderNumber: string
  issuedAt: string | null
  buyerName: string | null
  currency: string
  lines: ReceiptLine[]
  subtotalMinor: number
  serviceFeeMinor: number
  totalMinor: number
  refundedMinor: number
  paidWith: PaidWith
  event: ReceiptEvent & { title: string }
  organizerName: string
}

const toMinor = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** What the buyer was charged for this ticket (charged currency, major), add-ons included. */
function chargedMajor(t: ReceiptTicket): number {
  const c = Number(t.charged_amount)
  if (Number.isFinite(c) && c > 0) return c
  return Number(t.price_paid ?? t.pricePaid) || 0
}

/** Is there money on this ticket that passed through Tikèm? */
export function isReceiptableTicket(t: ReceiptTicket | null | undefined): boolean {
  if (!t) return false
  const method = String(t.payment_method ?? '').toLowerCase()
  if (method === 'pay_at_door' || method === 'physical' || String(t.source ?? '') === 'physical') return false
  return toMinor(chargedMajor(t)) > 0
}

/** "TK-3MZ9QK2L1A": the payment id without a Stripe prefix, last 10 characters. */
export function orderNumber(paymentId: string): string {
  const core = String(paymentId || '').replace(/^(pi|cs)_(test_|live_)?/, '').replace(/[^A-Za-z0-9]/g, '')
  return `TK-${core.slice(-10).toUpperCase() || 'UNKNOWN'}`
}

/** How the order was paid, from the ticket's funds rail / payment method. */
export function paidWithFor(t: ReceiptTicket | null | undefined): PaidWith {
  if (!t) return 'other'
  const method = String(t.payment_method ?? '').toLowerCase()
  if (method === 'natcash') return 'natcash'
  const rail = resolveFundsRail(t)
  if (rail === 'moncash') return 'moncash'
  if (rail === 'sogepay') return 'sogepay'
  if (rail === 'stripe_platform' || rail === 'stripe_connect') return 'card'
  if (rail === 'paypal') return 'paypal'
  if (rail === 'cash') return 'cash'
  return 'other'
}

export function buildReceipt(input: ReceiptInput): ReceiptModel | null {
  const tickets = (input.tickets || []).filter(isReceiptableTicket)
  if (tickets.length === 0) return null
  const currency = String(
    tickets.find((t) => t.charged_currency)?.charged_currency || tickets[0]?.original_currency || tickets[0]?.currency || 'HTG'
  ).toUpperCase()

  const byTier = new Map<string, ReceiptLine>()
  const addOnLines: ReceiptLine[] = []
  let feeMinor = 0
  let totalMinor = 0
  let refundedMinor = 0
  for (const t of tickets) {
    const charged = toMinor(chargedMajor(t))
    const fee = Math.min(charged, toMinor(t.buyer_fee_charged_amount))
    let face = charged - fee
    for (const a of ticketAddOns(t)) {
      const aFace = Math.max(0, toMinor(a.charged_amount) - toMinor(a.buyer_fee))
      face -= aFace
      addOnLines.push({ kind: 'addon', label: addOnLabel(a), quantity: a.quantity, unitMinor: 0, amountMinor: aFace })
    }
    face = Math.max(0, face)
    totalMinor += charged
    feeMinor += fee
    const label = String(t.tier_name || t.ticket_type || 'General Admission')
    const key = `${label}|${face}`
    const line = byTier.get(key) || { kind: 'ticket' as const, label, quantity: 0, unitMinor: face, amountMinor: 0 }
    line.quantity += 1
    line.amountMinor += face
    byTier.set(key, line)

    const refunded = String(t.status || '').toLowerCase() === 'refunded' || String(t.refund_status || '').toLowerCase() === 'approved'
    if (refunded) {
      const refundCurrency = String(t.refund_currency || currency).toUpperCase()
      const amount = toMinor(t.refund_amount)
      // A refund in the charged currency is taken as written (one that kept the
      // service fee returns less); otherwise the whole charge went back.
      refundedMinor += refundCurrency === currency && amount ? Math.min(amount, charged) : charged
    }
  }
  const lines = [...Array.from(byTier.values()), ...addOnLines]
  const subtotalMinor = lines.reduce((s, l) => s + l.amountMinor, 0)

  const issued =
    tickets
      .map((t) => t.purchased_at || t.created_at)
      .map((v) => (typeof v?.toDate === 'function' ? v.toDate().toISOString() : v ? String(v) : ''))
      .filter(Boolean)
      .sort()[0] || null
  return {
    orderId: input.paymentId,
    orderNumber: orderNumber(input.paymentId),
    issuedAt: issued,
    buyerName: tickets.find((t) => t.attendee_name && t.attendee_name !== 'Guest' && t.attendee_name !== 'Deleted user')?.attendee_name || null,
    currency,
    lines,
    subtotalMinor,
    serviceFeeMinor: feeMinor,
    totalMinor,
    refundedMinor: Math.min(refundedMinor, totalMinor),
    paidWith: paidWithFor(tickets[0]),
    event: {
      title: String(input.event?.title || 'Event'),
      start_datetime: input.event?.start_datetime ?? null,
      venue_name: input.event?.venue_name || null,
      city: input.event?.city || null,
      country: input.event?.country || null,
      timezone: input.event?.timezone || null,
    },
    organizerName: String(input.organizerName || '').trim() || 'Organizer',
  }
}

// ── Signed links ─────────────────────────────────────────────────────────────

/** A signed link stays valid this long (the app opens it in the browser at once). */
export const RECEIPT_LINK_TTL_MS = 60 * 60 * 1000

/** Null when no secret is configured: then no link is minted or accepted (fail closed). */
function receiptSecret(): Buffer | null {
  const explicit = process.env.RECEIPT_LINK_SECRET?.trim() || process.env.GUEST_TICKET_LINK_SECRET?.trim()
  if (explicit) return Buffer.from(`receipt|${explicit}`, 'utf8')
  const serviceKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()
  if (!serviceKey) return null
  return crypto.createHash('sha256').update(`tikem-receipt-link|${serviceKey}`).digest()
}

/** HMAC over the order id and the expiry, so a link cannot be re-dated or moved to another order. */
export function receiptKey(orderId: string, expiresAt: number): string {
  const secret = receiptSecret()
  if (!secret) throw new Error('receipt links are not configured')
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${expiresAt}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 22)
}

export function verifyReceiptKey(orderId: string, key: unknown, expiresAt: unknown, now = Date.now()): boolean {
  const exp = Number(expiresAt)
  if (!Number.isFinite(exp) || exp < now || exp > now + RECEIPT_LINK_TTL_MS + 60_000) return false
  if (!receiptSecret()) return false
  const provided = Buffer.from(String(key ?? ''), 'utf8')
  const expected = Buffer.from(receiptKey(orderId, exp), 'utf8')
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected)
}

/** /receipts/{orderId} (signed in) or, with `signed`, a short-lived link that needs no session. */
export function receiptPath(orderId: string, opts: { signed?: boolean; now?: number; lang?: string } = {}): string {
  const base = `/receipts/${encodeURIComponent(orderId)}`
  const params = new URLSearchParams()
  if (opts.signed) {
    const exp = (opts.now ?? Date.now()) + RECEIPT_LINK_TTL_MS
    params.set('exp', String(exp))
    params.set('k', receiptKey(orderId, exp))
  }
  if (opts.lang) params.set('lang', opts.lang)
  const q = params.toString()
  return q ? `${base}?${q}` : base
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function formatMinor(minor: number, currency: string, lang: ReceiptLang = 'en'): string {
  return formatMoneyFromCents(minor, currency, intlLocaleFor(lang))
}

/** A standalone, printable HTML receipt (light, A4/Letter friendly). */
export function renderReceiptHtml(r: ReceiptModel, langInput: string): string {
  const lang = receiptLang(langInput)
  const L = RECEIPT_LABELS[lang]
  const e = escapeHtml
  const money = (m: number) => e(formatMinor(m, r.currency, lang))
  const issued = r.issuedAt
    ? formatEventDateTime(r.issuedAt, r.event, lang, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''
  const when = r.event.start_datetime ? ticketDateLine(r.event.start_datetime, r.event, lang) : ''
  const venue = [r.event.venue_name, r.event.city].filter(Boolean).join(', ')

  const rows = r.lines
    .map(
      (l) =>
        `<tr><td>${e(l.label)}</td><td class="n">${l.kind === 'ticket' ? l.quantity : ''}</td><td class="n">${
          l.kind === 'ticket' ? money(l.unitMinor) : ''
        }</td><td class="n">${money(l.amountMinor)}</td></tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="${lang === 'ht' ? 'ht' : lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(L.receipt)} ${e(r.orderNumber)} · Tikèm</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f0; color: #111; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 680px; margin: 24px auto; background: #fff; padding: 32px; border-radius: 4px; }
  .brand { font-weight: 700; letter-spacing: .02em; font-size: 14px; margin-bottom: 20px; }
  h1 { font-size: 24px; margin: 0 0 2px; font-weight: 700; }
  .muted { color: #555; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px 24px; margin: 24px 0; }
  .meta div span { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b6b; }
  .meta small { display: block; color: #555; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: start; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b6b; padding: 8px 0; background: none; }
  tbody tr:nth-child(odd) td { background: #f7f7f5; }
  td { padding: 8px 6px; vertical-align: top; }
  .n { text-align: end; white-space: nowrap; padding-inline-start: 12px; }
  .sum td { background: none !important; padding: 4px 6px; }
  .total td { font-weight: 700; font-size: 17px; background: #f2f2f0 !important; padding: 10px 6px; }
  .small { font-size: 13px; color: #555; }
  footer { margin-top: 28px; }
  button { font: inherit; font-weight: 600; height: 40px; padding: 0 16px; border: 0; border-radius: 4px; background: #111; color: #fff; cursor: pointer; }
  @media print { body { background: #fff; } main { margin: 0; padding: 0; max-width: none; } .noprint { display: none; } }
  @media (max-width: 520px) { main { margin: 0; padding: 20px 16px; } }
</style>
</head>
<body>
<main>
  <div class="noprint" style="text-align:end;margin-bottom:12px"><button type="button" onclick="window.print()">${e(L.print)}</button></div>
  <div class="brand">tikèm</div>
  <h1>${e(L.receipt)}</h1>
  <div class="muted">${e(r.orderNumber)}</div>
  <div class="meta">
    <div><span>${e(L.date)}</span>${e(issued)}</div>
    ${r.buyerName ? `<div><span>${e(L.name)}</span>${e(r.buyerName)}</div>` : ''}
    <div><span>${e(L.event)}</span>${e(r.event.title)}${when ? `<small>${e(when)}</small>` : ''}${venue ? `<small>${e(venue)}</small>` : ''}</div>
    <div><span>${e(L.organizer)}</span>${e(r.organizerName)}</div>
    <div><span>${e(L.paidWith)}</span>${e(L.rails[r.paidWith])}</div>
  </div>
  <table>
    <thead><tr><th>${e(L.item)}</th><th class="n">${e(L.qty)}</th><th class="n"></th><th class="n">${e(L.amount)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table>
    <tbody>
      <tr class="sum"><td>${e(L.subtotal)}</td><td class="n">${money(r.subtotalMinor)}</td></tr>
      ${r.serviceFeeMinor > 0 ? `<tr class="sum"><td>${e(L.fee)}</td><td class="n">${money(r.serviceFeeMinor)}</td></tr>` : ''}
      <tr class="total"><td>${e(L.total)}</td><td class="n">${money(r.totalMinor)}</td></tr>
      ${r.refundedMinor > 0 ? `<tr class="sum"><td>${e(L.refunded)}</td><td class="n">−${money(r.refundedMinor)}</td></tr>` : ''}
    </tbody>
  </table>
  <footer class="small">
    <p>${e(L.soldBy)}</p>
    <p>${e(L.questions)} <a href="mailto:${TIKEM_SUPPORT_EMAIL}">${TIKEM_SUPPORT_EMAIL}</a></p>
  </footer>
</main>
</body>
</html>`
}
