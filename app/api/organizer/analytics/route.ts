import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getOrganizerEvents, getOrganizerTickets } from '@/lib/firestore/organizer'
import { format, subDays, startOfDay } from 'date-fns'
import { isLiveTicketStatus } from '@/lib/tickets/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Range = '7d' | '30d' | 'all'

/**
 * Organizer analytics summary for the mobile app (OrganizerAnalyticsScreen).
 *
 * The mobile screen calls this endpoint first and only falls back to a (slower,
 * client-side) Firestore aggregation if it fails. The response shape MUST match
 * what that screen consumes:
 *   { totalEvents, publishedEvents, totalTicketsSold, totalRevenue, currency,
 *     chartData: [{ date, sales, revenue }], topEvents: [{ id, title, ticketCount, revenueCents, currency }] }
 *
 * Revenue is organizer-facing: getOrganizerTickets() already normalizes each ticket's
 * `currency` to the event/original currency (not what the customer was charged), so
 * MonCash USD events report USD here, consistent with earnings.
 *
 * `revenueByCurrency` is keyed by every currency that sold (major units). USD and
 * HTG are always present so older app builds that read only those two keys keep
 * working; a CAD or EUR sale is no longer folded into USD.
 */

/** A scanned ticket was still a sale, so the check-in states count as sold. */
const SCANNED_STATUSES = new Set(['used', 'checked_in', 'scanned'])
const isSoldTicket = (status: unknown) =>
  isLiveTicketStatus(status) || SCANNED_STATUSES.has(String(status ?? '').toLowerCase().trim())

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rangeParam = String(searchParams.get('range') || '7d').toLowerCase()
    const range: Range = rangeParam === '30d' ? '30d' : rangeParam === 'all' || rangeParam === 'lifetime' ? 'all' : '7d'

    const [events, tickets] = await Promise.all([
      getOrganizerEvents(user.id),
      getOrganizerTickets(user.id),
    ])

    const now = new Date()
    const cutoffDate =
      range === 'all' ? null : range === '30d' ? startOfDay(subDays(now, 30)) : startOfDay(subDays(now, 7))

    const parseDate = (value: any): Date | null => {
      if (!value) return null
      const d = value instanceof Date ? value : new Date(value)
      return Number.isNaN(d.getTime()) ? null : d
    }

    // Revenue is tracked per currency (cents). The "primary" currency is whichever
    // has the most revenue, matching the mobile fallback's display logic.
    const revenueByCurrency: Record<string, number> = { USD: 0, HTG: 0 }
    const perEvent = new Map<string, { ticketCount: number; revenueCents: number; currency: string }>()

    // Last-7-days chart bins (the screen always renders the last 7 days).
    const dailySales: Record<string, { sales: number; revenue: number }> = {}
    for (let i = 6; i >= 0; i--) {
      dailySales[format(subDays(now, i), 'yyyy-MM-dd')] = { sales: 0, revenue: 0 }
    }

    const eventCurrencyById = new Map<string, string>(
      events.map((e: any) => [String(e.id), String(e.currency || 'HTG').toUpperCase()])
    )

    let totalTicketsSold = 0

    for (const ticket of tickets as any[]) {
      // Refunded, cancelled and pending tickets are not sales.
      if (!isSoldTicket(ticket.status)) continue
      const purchaseDate = parseDate(ticket.purchased_at) || parseDate(ticket.created_at)
      if (cutoffDate && purchaseDate && purchaseDate < cutoffDate) continue

      const eventId = String(ticket.event_id)
      const currency = String(ticket.currency || eventCurrencyById.get(eventId) || 'HTG').toUpperCase()
      const priceCents = Math.round((Number(ticket.price_paid) || 0) * 100)

      totalTicketsSold += 1
      revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + priceCents

      const existing = perEvent.get(eventId) || { ticketCount: 0, revenueCents: 0, currency }
      existing.ticketCount += 1
      existing.revenueCents += priceCents
      existing.currency = currency
      perEvent.set(eventId, existing)

      if (purchaseDate) {
        const key = format(purchaseDate, 'yyyy-MM-dd')
        if (dailySales[key]) {
          dailySales[key].sales += 1
          dailySales[key].revenue += priceCents / 100
        }
      }
    }

    const eventTitleById = new Map<string, string>(
      events.map((e: any) => [String(e.id), String(e.title || 'Untitled Event')])
    )

    const topEvents = Array.from(perEvent.entries())
      .map(([id, data]) => ({
        id,
        title: eventTitleById.get(id) || 'Untitled Event',
        ticketCount: data.ticketCount,
        revenueCents: data.revenueCents,
        currency: data.currency,
      }))
      .sort((a, b) => b.ticketCount - a.ticketCount)
      .slice(0, 5)

    // Primary = the currency with the most revenue; with no sales, the currency
    // most of the organizer's events use (HTG when there are none).
    const eventCurrencyCounts = new Map<string, number>()
    for (const c of eventCurrencyById.values()) eventCurrencyCounts.set(c, (eventCurrencyCounts.get(c) || 0) + 1)
    const dominantEventCurrency =
      Array.from(eventCurrencyCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'HTG'
    const soldCurrencies = Object.entries(revenueByCurrency)
      .filter(([, cents]) => cents > 0)
      .sort((a, b) => b[1] - a[1])
    const primaryCurrency = soldCurrencies[0]?.[0] || dominantEventCurrency

    const chartData = Object.keys(dailySales)
      .sort()
      .map((key) => ({
        date: format(new Date(key), 'MMM dd'),
        sales: dailySales[key].sales,
        revenue: dailySales[key].revenue,
      }))

    return NextResponse.json({
      totalEvents: events.length,
      publishedEvents: events.filter((e: any) => e.is_published).length,
      totalTicketsSold,
      totalRevenue: (revenueByCurrency[primaryCurrency] || 0) / 100,
      currency: primaryCurrency,
      revenueByCurrency: Object.fromEntries(
        Object.entries(revenueByCurrency).map(([code, cents]) => [code, cents / 100])
      ),
      chartData,
      topEvents,
      range,
    })
  } catch (error: any) {
    console.error('Organizer analytics error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to load analytics' },
      { status: 500 }
    )
  }
}
