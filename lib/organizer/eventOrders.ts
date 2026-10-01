import { isLiveTicketStatus } from '@/lib/tickets/status'
import { planTicketRefund, sumRefundsByCurrency, type RefundPlan } from '@/lib/tickets/refundPlan'

/**
 * Pure shaping for the organizer's per-event Orders and Analytics surfaces.
 *
 * The web pages (app/organizer/events/[id]/orders and /analytics) read Firestore
 * in a server component; the mobile app cannot (buyer names and emails live on
 * `users` docs, which rules keep owner-only). The JSON routes that serve mobile
 * load the same tickets and hand them here, so both clients count the same way.
 *
 * Firestore access lives in ./eventOrdersLoader.ts; nothing in this file touches
 * the database, so it is unit-tested directly.
 */

export interface BuyerInfo {
  name: string
  email: string
  city: string
}

export interface EventTicketRow {
  id: string
  status: string
  tierId: string
  tierName: string
  pricePaid: number
  currency: string
  paymentMethod: string
  purchasedAt: string
  checkedInAt: string
  checkedIn: boolean
  buyerKey: string
  buyer: BuyerInfo
  isGuest: boolean
  orderKey: string
  refund: RefundPlan
}

export interface MoneyLine {
  currency: string
  amount: number
}

export interface EventOrder {
  id: string
  quantity: number
  liveCount: number
  checkedInCount: number
  buyer: BuyerInfo
  isGuest: boolean
  tiers: { name: string; count: number }[]
  /** Organizer-facing amount (face value, event currency), per currency. */
  amounts: MoneyLine[]
  paymentMethod: string
  status: 'paid' | 'free' | 'refunded' | 'refund_pending' | 'partially_refunded' | 'cancelled'
  purchasedAt: string
  tickets: {
    id: string
    tierName: string
    pricePaid: number
    currency: string
    status: string
    checkedInAt: string
    refund: RefundPlan
  }[]
  refund: {
    eligibleTicketIds: string[]
    /** What the BUYER gets back, in the currency they were charged. */
    totals: MoneyLine[]
    rails: string[]
  }
  canResend: boolean
}

/** Live, or a legacy doc whose status was overwritten to `checked_in` at the door. */
function counts(status: string): boolean {
  return isLiveTicketStatus(status) || status === 'checked_in'
}

export function serializeTs(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof (v as any).toDate === 'function') return (v as any).toDate().toISOString()
  if (typeof (v as any)._seconds === 'number') return new Date((v as any)._seconds * 1000).toISOString()
  if (typeof (v as any).seconds === 'number') return new Date((v as any).seconds * 1000).toISOString()
  return ''
}

/** The person who should receive / is named on the ticket, before a user-doc lookup. */
export function buyerIdOf(d: Record<string, any>): string {
  return String(d.attendee_id || d.user_id || '')
}

export function isGuestTicket(d: Record<string, any>): boolean {
  return Boolean(d.is_guest) || buyerIdOf(d).startsWith('guest_')
}

/**
 * Normalize one ticket doc. `profile` is the buyer's user doc (if any). Guest
 * and comp tickets carry their own contact details.
 */
export function toTicketRow(
  id: string,
  d: Record<string, any>,
  profile: Record<string, any> | null,
  eventCurrency: string
): EventTicketRow {
  const guest = isGuestTicket(d)
  const buyerId = buyerIdOf(d)
  const name = String(
    (!guest && (profile?.full_name || profile?.display_name || profile?.name)) ||
      d.attendee_name ||
      d.recipient_name ||
      d.user_name ||
      d.buyer_name ||
      ''
  ).trim()
  const email = String(
    (guest ? d.guest_email : profile?.email) || d.guest_email || d.recipient_email || d.user_email || ''
  ).trim()
  const city = String((!guest && (profile?.default_city || profile?.city)) || '').trim()

  const purchasedAt = serializeTs(d.purchased_at) || serializeTs(d.created_at) || serializeTs(d.createdAt)
  const checkedInAt = serializeTs(d.checked_in_at)
  const status = String(d.status || 'active').toLowerCase()
  const buyerKey = buyerId || email.toLowerCase() || name.toLowerCase() || `ticket:${id}`

  // Tickets bought together share a payment reference. Comps and free claims
  // have none, so fall back to "same holder, same minute".
  const paymentRef = String(d.payment_intent_id || d.payment_id || d.transaction_id || d.order_id || '').trim()
  const orderKey = paymentRef || `${buyerKey}|${purchasedAt.slice(0, 16) || id}`

  return {
    id,
    status,
    tierId: String(d.tier_id || ''),
    tierName: String(d.tier_name || d.ticket_type || '').trim(),
    pricePaid: Number(d.price_paid ?? d.price ?? 0) || 0,
    currency: String(d.original_currency || d.currency || eventCurrency || 'HTG').toUpperCase(),
    paymentMethod: String(d.payment_method || (d.source === 'comp' ? 'comp' : '')).toLowerCase(),
    purchasedAt,
    checkedInAt,
    checkedIn: Boolean(checkedInAt) || d.checked_in === true || status === 'checked_in',
    buyerKey,
    buyer: { name, email, city },
    isGuest: guest,
    orderKey,
    refund: planTicketRefund(d),
  }
}

function orderStatus(rows: EventTicketRow[]): EventOrder['status'] {
  const live = rows.filter((r) => counts(r.status)).length
  const refunded = rows.filter((r) => r.status === 'refunded').length
  const pending = rows.filter((r) => r.status === 'refund_pending').length
  if (live === rows.length) {
    return rows.every((r) => r.pricePaid <= 0) ? 'free' : 'paid'
  }
  if (live > 0) return 'partially_refunded'
  if (pending > 0) return 'refund_pending'
  if (refunded > 0) return 'refunded'
  return 'cancelled'
}

export function groupOrders(rows: EventTicketRow[]): EventOrder[] {
  const groups = new Map<string, EventTicketRow[]>()
  for (const row of rows) {
    const list = groups.get(row.orderKey)
    if (list) list.push(row)
    else groups.set(row.orderKey, [row])
  }

  const orders: EventOrder[] = []
  for (const [key, list] of groups) {
    list.sort((a, b) => a.id.localeCompare(b.id))
    const first = list[0]
    const tierCounts = new Map<string, number>()
    const amounts = new Map<string, number>()
    for (const r of list) {
      const tier = r.tierName || ''
      tierCounts.set(tier, (tierCounts.get(tier) || 0) + 1)
      if (r.pricePaid > 0) amounts.set(r.currency, (amounts.get(r.currency) || 0) + r.pricePaid)
    }
    const eligible = list.filter((r) => r.refund.eligible)
    const purchasedAt = list
      .map((r) => r.purchasedAt)
      .filter(Boolean)
      .sort()[0] || ''

    orders.push({
      id: key.includes('|') ? first.id : key,
      quantity: list.length,
      liveCount: list.filter((r) => counts(r.status)).length,
      checkedInCount: list.filter((r) => r.checkedIn).length,
      buyer: first.buyer,
      isGuest: first.isGuest,
      tiers: Array.from(tierCounts.entries()).map(([name, count]) => ({ name, count })),
      amounts: Array.from(amounts.entries()).map(([currency, amount]) => ({
        currency,
        amount: Math.round(amount * 100) / 100,
      })),
      paymentMethod: first.paymentMethod,
      status: orderStatus(list),
      purchasedAt,
      tickets: list.map((r) => ({
        id: r.id,
        tierName: r.tierName,
        pricePaid: r.pricePaid,
        currency: r.currency,
        status: r.status,
        checkedInAt: r.checkedInAt,
        refund: r.refund,
      })),
      refund: {
        eligibleTicketIds: eligible.map((r) => r.id),
        totals: sumRefundsByCurrency(eligible.map((r) => r.refund)),
        rails: Array.from(new Set(eligible.map((r) => (r.refund.eligible ? r.refund.rail : '')))).filter(Boolean),
      },
      canResend: Boolean(first.buyer.email) && list.some((r) => counts(r.status)),
    })
  }

  return orders.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
}

export interface EventAnalytics {
  ticketsSold: number
  capacity: number
  checkedIn: number
  checkInRate: number
  revenue: MoneyLine[]
  salesByDay: { date: string; count: number }[]
  tiers: { name: string; sold: number; revenue: MoneyLine[] }[]
  cities: { city: string; buyers: number }[]
  buyersWithoutCity: number
  totalBuyers: number
}

/**
 * Same counting as the web analytics page, with one correction the house rule
 * requires: a ticket counts when its status is LIVE (valid / confirmed /
 * active). The web page counts "not cancelled", which keeps refunded tickets in
 * the totals.
 */
export function computeEventAnalytics(rows: EventTicketRow[], capacity: number): EventAnalytics {
  const live = rows.filter((r) => counts(r.status))
  const ticketsSold = live.length
  const checkedIn = live.filter((r) => r.checkedIn).length

  const revenue = new Map<string, number>()
  const byDay = new Map<string, number>()
  const tiers = new Map<string, { name: string; sold: number; revenue: Map<string, number> }>()
  const buyerCity = new Map<string, string>()

  for (const r of live) {
    if (r.pricePaid > 0) revenue.set(r.currency, (revenue.get(r.currency) || 0) + r.pricePaid)
    if (r.purchasedAt) {
      const day = r.purchasedAt.slice(0, 10)
      byDay.set(day, (byDay.get(day) || 0) + 1)
    }
    const tierKey = r.tierId || r.tierName || 'default'
    const tier = tiers.get(tierKey) || { name: r.tierName, sold: 0, revenue: new Map<string, number>() }
    tier.sold += 1
    if (r.pricePaid > 0) tier.revenue.set(r.currency, (tier.revenue.get(r.currency) || 0) + r.pricePaid)
    tiers.set(tierKey, tier)
    if (!buyerCity.has(r.buyerKey) || (!buyerCity.get(r.buyerKey) && r.buyer.city)) {
      buyerCity.set(r.buyerKey, r.buyer.city)
    }
  }

  const cityCounts = new Map<string, { city: string; buyers: number }>()
  let buyersWithoutCity = 0
  for (const city of buyerCity.values()) {
    if (!city) {
      buyersWithoutCity += 1
      continue
    }
    const key = city.toLowerCase()
    const entry = cityCounts.get(key) || { city, buyers: 0 }
    entry.buyers += 1
    cityCounts.set(key, entry)
  }

  const money = (m: Map<string, number>): MoneyLine[] =>
    Array.from(m.entries())
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)

  return {
    ticketsSold,
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
    checkedIn,
    checkInRate: ticketsSold > 0 ? checkedIn / ticketsSold : 0,
    revenue: money(revenue),
    salesByDay: Array.from(byDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    tiers: Array.from(tiers.values())
      .map((t) => ({ name: t.name, sold: t.sold, revenue: money(t.revenue) }))
      .sort((a, b) => b.sold - a.sold),
    cities: Array.from(cityCounts.values()).sort((a, b) => b.buyers - a.buyers || a.city.localeCompare(b.city)),
    buyersWithoutCity,
    totalBuyers: buyerCity.size,
  }
}
