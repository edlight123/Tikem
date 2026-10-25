import { normalizeCurrency } from '@/lib/money'
import { isSoldTicketStatus } from '@/lib/organizer/eventOrders'

/**
 * Sales totals for the organizer's event pages and the org-wide analytics page.
 *
 * Pure: callers load the ticket docs (lib/tickets/loadTicketsForEvent) and hand
 * the raw data here, so every surface counts the same way and it is unit-tested.
 *
 * Counting rules, the same as the per-event earnings view (lib/earnings.ts
 * deriveEventEarningsFromTickets):
 *   - a ticket counts when its status is live (valid / confirmed / active) or a
 *     legacy `checked_in`; refunded, refund_pending and cancelled never count,
 *     nor does a ticket whose refund was approved but whose status lags;
 *   - revenue is `price_paid` (major units, the event's listed price) in the
 *     ticket's ORIGINAL currency, else the event currency. Never the charged
 *     currency: an HTG event paid by card is charged in USD, but it sold in HTG;
 *   - money is kept per currency. Nothing here adds HTG to USD.
 */

export type TicketLike = Record<string, any>

export function ticketCountsAsSold(t: TicketLike): boolean {
  if (!isSoldTicketStatus(t?.status)) return false
  if (String(t?.refund_status || '').toLowerCase().trim() === 'approved') return false
  return true
}

export function ticketRevenueCents(t: TicketLike): number {
  const major = Number(t?.price_paid ?? t?.pricePaid ?? 0)
  const cents = Math.round(major * 100)
  return Number.isFinite(cents) && cents > 0 ? cents : 0
}

export function ticketSaleCurrency(t: TicketLike, eventCurrency: string): string {
  return normalizeCurrency(t?.original_currency || eventCurrency, 'HTG')
}

function isCheckedIn(t: TicketLike): boolean {
  return t?.checked_in === true || Boolean(t?.checked_in_at) || String(t?.status || '').toLowerCase() === 'checked_in'
}

export interface EventSalesSummary {
  ticketsSold: number
  checkedIn: number
  /** cents per currency; empty when nothing paid was sold. */
  revenueByCurrencyCents: Record<string, number>
}

export function summarizeEventTickets(tickets: TicketLike[], eventCurrency: string): EventSalesSummary {
  const out: EventSalesSummary = { ticketsSold: 0, checkedIn: 0, revenueByCurrencyCents: {} }
  for (const t of tickets) {
    if (!ticketCountsAsSold(t)) continue
    out.ticketsSold += 1
    if (isCheckedIn(t)) out.checkedIn += 1
    const cents = ticketRevenueCents(t)
    if (cents > 0) {
      const cur = ticketSaleCurrency(t, eventCurrency)
      out.revenueByCurrencyCents[cur] = (out.revenueByCurrencyCents[cur] || 0) + cents
    }
  }
  return out
}

export interface OrgEventInput {
  id: string
  currency?: string | null
  [key: string]: any
}

export interface OrgEventSales {
  id: string
  currency: string
  ticketCount: number
  /** In the event's own currency. */
  revenueCents: number
  /** Every currency this event sold in (normally just its own). */
  revenueByCurrencyCents: Record<string, number>
}

export interface OrgSalesSummary {
  totalTicketsSold: number
  /** Per currency, never summed across currencies. */
  revenueByCurrencyCents: Record<string, number>
  /** The currency with the most revenue (the headline figure), else the most common event currency. */
  primaryCurrency: string
  events: OrgEventSales[]
  /** Sold tickets in the last 7 days (today included), oldest first, keyed YYYY-MM-DD. */
  last7Days: { date: string; sales: number; revenueCents: number }[]
}

function ticketDate(t: TicketLike): Date | null {
  const raw = t?.purchased_at ?? t?.created_at
  if (!raw) return null
  const d = typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Org-wide totals from the org's events and each event's tickets.
 * `ticketsByEvent` maps event id to that event's raw ticket docs.
 */
export function summarizeOrgSales(
  events: OrgEventInput[],
  ticketsByEvent: Map<string, TicketLike[]>,
  now: Date = new Date()
): OrgSalesSummary {
  const revenue: Record<string, number> = {}
  const eventCurrencyCount: Record<string, number> = {}
  let total = 0
  const perEvent: OrgEventSales[] = []

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const windowStart = new Date(today)
  windowStart.setDate(windowStart.getDate() - 6)
  const dayKey = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const days = new Map<string, { sales: number; revenueByCurrency: Record<string, number> }>()
  for (let i = 0; i < 7; i++) {
    const d = new Date(windowStart)
    d.setDate(windowStart.getDate() + i)
    days.set(dayKey(d), { sales: 0, revenueByCurrency: {} })
  }

  for (const event of events) {
    const eventCurrency = normalizeCurrency(event.currency, 'HTG')
    eventCurrencyCount[eventCurrency] = (eventCurrencyCount[eventCurrency] || 0) + 1
    const tickets = ticketsByEvent.get(String(event.id)) || []
    const summary = summarizeEventTickets(tickets, eventCurrency)
    total += summary.ticketsSold
    for (const [cur, cents] of Object.entries(summary.revenueByCurrencyCents)) {
      revenue[cur] = (revenue[cur] || 0) + cents
    }
    perEvent.push({
      id: String(event.id),
      currency: eventCurrency,
      ticketCount: summary.ticketsSold,
      revenueCents: summary.revenueByCurrencyCents[eventCurrency] || 0,
      revenueByCurrencyCents: summary.revenueByCurrencyCents,
    })

    for (const t of tickets) {
      if (!ticketCountsAsSold(t)) continue
      const d = ticketDate(t)
      if (!d || d < windowStart) continue
      const bucket = days.get(dayKey(d))
      if (!bucket) continue
      bucket.sales += 1
      const cents = ticketRevenueCents(t)
      if (cents > 0) {
        const cur = ticketSaleCurrency(t, eventCurrency)
        bucket.revenueByCurrency[cur] = (bucket.revenueByCurrency[cur] || 0) + cents
      }
    }
  }

  const byRevenue = Object.entries(revenue).sort((a, b) => b[1] - a[1])
  const byEvents = Object.entries(eventCurrencyCount).sort((a, b) => b[1] - a[1])
  const primaryCurrency = byRevenue[0]?.[0] || byEvents[0]?.[0] || 'HTG'

  return {
    totalTicketsSold: total,
    revenueByCurrencyCents: revenue,
    primaryCurrency,
    events: perEvent,
    last7Days: Array.from(days.entries()).map(([date, v]) => ({
      date,
      sales: v.sales,
      // The chart has one money axis: it plots the headline currency only.
      revenueCents: v.revenueByCurrency[primaryCurrency] || 0,
    })),
  }
}
