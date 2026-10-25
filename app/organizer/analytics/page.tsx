import AnalyticsView from './AnalyticsView'
import { createClient } from '@/lib/firebase-db/server'
import Link from 'next/link'
import { requireOrgPage } from '../_lib/orgPage'
import SalesChart from '@/components/charts/SalesChart'
import CategoryChart from '@/components/charts/CategoryChart'
import { TrendingUp, DollarSign, Ticket, Calendar } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { formatMoneyFromCents, normalizeCurrency } from '@/lib/money'
import { PageHeader, MetricCard, SectionHeader, OrgEmptyState } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'

export const revalidate = 120 // Cache for 2 minutes

// Depends on auth cookies and organizer-specific data.
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const { orgId } = await requireOrgPage('view', '/organizer/analytics')

  const supabase = await createClient()

  // Fetch organizer's events only.
  const eventsQuery = await supabase
    .from('events')
    .select('id,title,start_datetime,is_published,category,organizer_id,currency')
    .eq('organizer_id', orgId)

  const allOrganizerEvents = eventsQuery.data || []

  // Organizer-facing analytics should be shown in the event currency (no FX conversion).
  // If an organizer has mixed currencies (unexpected), prefer USD and scope analytics to that currency.
  const eventCurrencies = new Set<string>(
    allOrganizerEvents.map((e: any) => normalizeCurrency(e?.currency, 'HTG'))
  )

  const organizerCurrency: string = (() => {
    const values = Array.from(eventCurrencies)
    if (values.length === 1) return values[0]
    if (eventCurrencies.has('USD')) return 'USD'
    return values[0] || 'HTG'
  })()

  const eventsData = allOrganizerEvents.filter(
    (e: any) => normalizeCurrency(e?.currency, 'HTG') === organizerCurrency
  )

  // Fetch tickets for organizer's events in the chosen currency.
  // Join through events to avoid large `IN (...)` lists as event count grows.
  const ticketsQuery = eventsData.length
    ? await supabase
        .from('tickets')
        .select('event_id,price_paid,created_at,status,events!inner(organizer_id,currency)')
        .eq('events.organizer_id', orgId)
        .eq('events.currency', organizerCurrency)
    : { data: [] as any[] }

  const allTickets = (ticketsQuery as any).data || []

  const isValidTicketStatus = (raw: unknown) => {
    const status = String(raw || '').toLowerCase()
    // Legacy + current accepted values.
    if (!status) return true
    return status === 'valid' || status === 'confirmed'
  }
  
  // Group tickets by event
  const ticketsByEvent = new Map<string, { ticketCount: number; revenueCents: number }>()

  allTickets.forEach((ticket: any) => {
    if (!isValidTicketStatus(ticket?.status)) return
    const eventId = String(ticket?.event_id || '')
    if (!eventId) return

    const pricePaid = Number(ticket?.price_paid || 0)
    const revenueCents = Math.round(pricePaid * 100)
    if (!Number.isFinite(revenueCents) || revenueCents <= 0) {
      // Free tickets still count as tickets sold.
      const existing = ticketsByEvent.get(eventId) || { ticketCount: 0, revenueCents: 0 }
      ticketsByEvent.set(eventId, { ticketCount: existing.ticketCount + 1, revenueCents: existing.revenueCents })
      return
    }

    const existing = ticketsByEvent.get(eventId) || { ticketCount: 0, revenueCents: 0 }
    ticketsByEvent.set(eventId, {
      ticketCount: existing.ticketCount + 1,
      revenueCents: existing.revenueCents + revenueCents,
    })
  })

  // Calculate analytics
  const totalEvents = eventsData.length
  let totalTicketsSold = 0
  let totalRevenueCents = 0
  
  eventsData.forEach((event: any) => {
    const stats = ticketsByEvent.get(String(event.id)) || { ticketCount: 0, revenueCents: 0 }
    totalTicketsSold += stats.ticketCount
    totalRevenueCents += stats.revenueCents
  })
  
  const publishedEvents = eventsData.filter((e: any) => e.is_published).length

  // Events with ticket sales
  const eventsWithSales = eventsData.map((event: any) => {
    const stats = ticketsByEvent.get(String(event.id)) || { ticketCount: 0, revenueCents: 0 }
    return {
      ...event,
      ticketCount: stats.ticketCount,
      revenueCents: stats.revenueCents,
    }
  }).sort((a: any, b: any) => b.ticketCount - a.ticketCount)

  // Prepare chart data - Sales over time (last 7 days)
  const salesByDay: Record<string, { sales: number; revenueCents: number }> = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfWindow = new Date(today)
  startOfWindow.setDate(startOfWindow.getDate() - 6)

  for (const t of allTickets) {
    if (!isValidTicketStatus(t?.status)) continue
    const createdAt = new Date(t?.created_at)
    if (isNaN(createdAt.getTime())) continue
    if (createdAt < startOfWindow) continue

    const key = createdAt.toISOString().split('T')[0]
    const existing = salesByDay[key] || { sales: 0, revenueCents: 0 }
    const cents = Math.round(Number(t?.price_paid || 0) * 100)

    salesByDay[key] = {
      sales: existing.sales + 1,
      revenueCents: existing.revenueCents + (Number.isFinite(cents) ? Math.max(0, cents) : 0),
    }
  }

  const salesChartData = []
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    const day = salesByDay[dateStr] || { sales: 0, revenueCents: 0 }

    salesChartData.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sales: day.sales,
      revenue: day.revenueCents / 100,
    })
  }

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
      totalRevenueCents={totalRevenueCents}
      organizerCurrency={organizerCurrency}
      salesChartData={salesChartData}
      categoryChartData={categoryChartData}
      eventsWithSales={eventsWithSales}
    />
  )
}
