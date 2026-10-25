import { requireEventPage } from '../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { isAdmin } from '@/lib/admin'
import { EventCommandCenter } from './EventCommandCenter'
import { normalizeCurrency } from '@/lib/money'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { summarizeEventTickets, ticketCountsAsSold } from '@/lib/organizer/salesSummary'

export const revalidate = 0

export default async function EventCommandCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Owner, org admin/manager, or platform admin (layout already 404s others).
  const { event: eventData } = await requireEventPage(id, 'view')

  // Fetch tickets for this event (supports legacy `eventId` field too)
  const ticketDocs = await loadTicketDocsForEvent(id)
  const ticketDatas = ticketDocs.map((doc: any) => doc.data() || {})

  const tickets = ticketDocs.map((doc: any) => {
    const data = doc.data()
    return {
      id: doc.id,
      price_paid: data.price_paid || 0,
      currency: data.currency || null,
      status: data.status || 'active',
      checked_in_at: data.checked_in_at?.toDate?.()?.toISOString() || data.checked_in_at,
      purchased_at: data.purchased_at?.toDate?.()?.toISOString() || data.purchased_at,
      tier_id: data.tier_id,
      // Live (valid / confirmed / active): refunded and cancelled never count.
      sold: ticketCountsAsSold(data),
    }
  })

  // Fetch ticket tiers
  const tiersSnapshot = await adminDb
    .collection('ticket_tiers')
    .where('event_id', '==', id)
    .get()

  const tiers = tiersSnapshot.docs.map((doc: any) => {
    const data = doc.data()
    return {
      id: doc.id,
      name: data.name,
      price: data.price || 0,
      quantity: data.total_quantity || 0,
      description: data.description,
      sold: data.sold_quantity || 0
    }
  })

  // Convert Firestore Timestamps to ISO strings
  const convertTimestamp = (value: any): string => {
    if (!value) return new Date().toISOString()
    if (value.toDate && typeof value.toDate === 'function') {
      return value.toDate().toISOString()
    }
    if (typeof value === 'string') return value
    if (value instanceof Date) return value.toISOString()
    return new Date().toISOString()
  }

  const event = {
    id,
    title: eventData.title,
    description: eventData.description,
    start_datetime: convertTimestamp(eventData.start_datetime),
    end_datetime: convertTimestamp(eventData.end_datetime),
    venue_name: eventData.venue_name,
    address: eventData.venue_address || eventData.address,
    city: eventData.city,
    commune: eventData.commune,
    is_online: eventData.is_online || false,
    meeting_url: eventData.meeting_url,
    banner_image_url: eventData.banner_image || eventData.banner_image_url,
    category: eventData.category,
    is_published: eventData.is_published || false,
    currency: eventData.currency || null,
    max_attendees: eventData.max_attendees || 0,
    created_at: convertTimestamp(eventData.created_at),
    updated_at: convertTimestamp(eventData.updated_at),
    organizer_id: eventData.organizer_id
  }

  // Live tickets only: a refunded or refund-pending ticket is not a sale.
  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')
  const sales = summarizeEventTickets(ticketDatas, eventCurrency)
  const ticketsSold = sales.ticketsSold
  const checkedIn = sales.checkedIn
  const revenueByCurrencyCents = sales.revenueByCurrencyCents
  const revenueCents = revenueByCurrencyCents[eventCurrency] || 0

  const stats = {
    ticketsSold,
    capacity: eventData.total_tickets || 0,
    revenueCents,
    revenueByCurrencyCents,
    currency: eventCurrency,
    checkedIn,
  }

  return (
    <div className="bg-[#0a0a0a]">      <EventCommandCenter 
        event={event} 
        stats={stats}
        tickets={tickets}
        tiers={tiers}
      />
    </div>
  )
}
