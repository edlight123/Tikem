import { requireEventPage } from '../../../_lib/orgPage'
import { AttendeesManager } from './AttendeesManager'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { loadProfiles } from '@/lib/organizer/eventOrdersLoader'
import { buyerIdOf, isGuestTicket, toTicketRow } from '@/lib/organizer/eventOrders'
import { normalizeCurrency } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AttendeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params

  // Owner, org admin/manager, or platform admin; others 404 (the layout too).
  const { event: eventData } = await requireEventPage(eventId, 'view', `/organizer/events/${eventId}/attendees`)
  const event = {
    id: eventId,
    title: eventData.title,
    organizer_id: eventData.organizer_id,
    start_datetime: eventData.start_datetime?.toDate?.()?.toISOString() || eventData.start_datetime,
    total_tickets: eventData.total_tickets,
    tickets_sold: eventData.tickets_sold
  }

  // Fetch all tickets for this event (supports legacy `eventId` field too)
  let ticketDocs: any[] = []
  let ticketsError = false
  try {
    ticketDocs = await loadTicketDocsForEvent(eventId)
  } catch (error) {
    console.error('Error fetching tickets:', error)
    ticketsError = true
    ticketDocs = []
  }

  // Buyer details: the account's profile when there is one, else what the
  // ticket itself carries. Guest checkouts (attendee_id guest_…) and comps or
  // guest-list tickets have no users doc: their name and contact live on the
  // ticket (attendee_name / recipient_name, guest_email / recipient_email,
  // guest_phone), so they no longer show as "Unknown".
  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')
  const datas = ticketDocs.map((doc: any) => ({ id: doc.id as string, data: (doc.data() || {}) as Record<string, any> }))
  const profiles = await loadProfiles(
    datas.filter(({ data }) => !isGuestTicket(data)).map(({ data }) => buyerIdOf(data))
  )

  const tickets = datas.map(({ id, data: ticketData }) => {
    const profile = isGuestTicket(ticketData) ? null : profiles.get(buyerIdOf(ticketData)) || null
    const row = toTicketRow(id, ticketData, profile, eventCurrency)
    const phone = String((profile && profile.phone_number) || ticketData.guest_phone || '').trim()
    const attendee =
      row.buyer.name || row.buyer.email || phone
        ? { id: buyerIdOf(ticketData), full_name: row.buyer.name, email: row.buyer.email, phone_number: phone }
        : null

    return {
      id,
      event_id: ticketData.event_id || ticketData.eventId || '',
      attendee_id: ticketData.attendee_id || '',
      status: String(ticketData.status || 'confirmed').toLowerCase(),
      ticket_type: row.tierName || 'General Admission',
      ticket_tier_id: ticketData.tier_id || ticketData.ticket_tier_id || '',
      price_paid: ticketData.price_paid || 0,
      currency: ticketData.original_currency || ticketData.currency || null,
      quantity: ticketData.quantity || 1,
      checked_in: row.checkedIn,
      source: String(ticketData.source || ''),
      is_guest: row.isGuest,
      qr_code: ticketData.qr_code || ticketData.qr_code_data || '',
      qr_code_data: ticketData.qr_code_data || ticketData.qr_code || '',
      attendee,
      purchased_at: row.purchasedAt || new Date().toISOString(),
      checked_in_at: row.checkedInAt || null,
    }
  })

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <AttendeesManager
        eventId={eventId}
        eventTitle={event.title}
        tickets={tickets}
        ticketsError={ticketsError}
      />
    </div>
  )
}
