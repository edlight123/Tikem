import AnalyticsView from './AnalyticsView'
import { requireOrgPage } from '../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { summarizeOrgSales } from '@/lib/organizer/salesSummary'
import { revalidatePath } from 'next/cache'
import { normalizeCurrency } from '@/lib/money'

export const revalidate = 120 // Cache for 2 minutes

// Depends on auth cookies and organizer-specific data.
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const { orgId } = await requireOrgPage('view', '/organizer/analytics')

  // The org's events (organizer_id = the org, docs/specs/org-teams.md).
  const eventsSnap = await adminDb.collection('events').where('organizer_id', '==', orgId).get()
  type OrgEventRow = {
    id: string
    title: string
    start_datetime: any
    is_published: boolean
    category: string
    currency: string
  }
  const eventsData: OrgEventRow[] = eventsSnap.docs.map((d: any) => {
    const e = d.data() || {}
    return {
      id: d.id,
      title: String(e.title || ''),
      start_datetime: e.start_datetime?.toDate?.()?.toISOString?.() ?? e.start_datetime ?? null,
      is_published: Boolean(e.is_published),
      category: String(e.category || 'Other'),
      currency: normalizeCurrency(e.currency, 'HTG'),
    }
  })

  // Then each event's tickets (both event_id and the legacy eventId field), a
  // few events at a time. The old version joined tickets to events with
  // Supabase syntax the Firestore shim does not support, so every total was 0.
  const ticketsByEvent = new Map<string, Record<string, any>[]>()
  for (let i = 0; i < eventsData.length; i += 10) {
    const chunk = eventsData.slice(i, i + 10)
    const results = await Promise.all(
      chunk.map((e) => loadTicketDocsForEvent(e.id).catch(() => [] as any[]))
    )
    chunk.forEach((e, idx) => {
      ticketsByEvent.set(e.id, results[idx].map((doc: any) => doc.data() || {}))
    })
  }

  // Live tickets only; money per currency, each event in its own currency.
  const summary = summarizeOrgSales(eventsData, ticketsByEvent)
  const salesByEvent = new Map(summary.events.map((e) => [e.id, e]))

  const totalEvents = eventsData.length
  const totalTicketsSold = summary.totalTicketsSold
  const publishedEvents = eventsData.filter((e) => e.is_published).length

  const eventsWithSales = eventsData
    .map((event) => {
      const stats = salesByEvent.get(event.id)
      return {
        ...event,
        ticketCount: stats?.ticketCount || 0,
        revenueCents: stats?.revenueCents || 0,
      }
    })
    .sort((a, b) => b.ticketCount - a.ticketCount)

  const salesChartData = summary.last7Days.map((day) => ({
    date: new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sales: day.sales,
    revenue: day.revenueCents / 100,
  }))

  // Category distribution
  const categoryData: Record<string, number> = {}
  eventsData.forEach((event: any) => {
    categoryData[event.category] = (categoryData[event.category] || 0) + 1
  })
  const categoryChartData = Object.entries(categoryData).map(([name, value]) => ({ name, value }))

  async function refreshPage() {
    'use server'
    revalidatePath('/organizer/analytics')
  }

  return (
    <AnalyticsView
      totalEvents={totalEvents}
      publishedEvents={publishedEvents}
      totalTicketsSold={totalTicketsSold}
      revenueByCurrencyCents={summary.revenueByCurrencyCents}
      organizerCurrency={summary.primaryCurrency}
      salesChartData={salesChartData}
      categoryChartData={categoryChartData}
      eventsWithSales={eventsWithSales}
    />
  )
}
