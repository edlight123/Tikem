import { requireEventPage } from '../../../_lib/orgPage'
import { CheckInInterface } from '@/components/check-in/CheckInInterface'
import { checkInTicket } from './actions'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CheckInPage({ params }: PageProps) {
  const { id: eventId } = await params
  
  // Owner, org admin/manager, or platform admin (manage_events covers check-in).
  const { event: eventData } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/check-in`)

  // Fetch all tickets for this event (supports legacy `eventId` field too)
  const ticketDocs = await loadTicketDocsForEvent(eventId)

  const tickets = ticketDocs.map((doc: any) => {
    const data = doc.data()
    return {
      id: doc.id,
      event_id: data.event_id || data.eventId,
      user_id: data.user_id,
      order_id: data.order_id,
      ticket_type: data.ticket_type,
      price: data.price,
      status: data.status,
      checked_in: data.checked_in || false,
      checked_in_at: data.checked_in_at?.toDate?.()?.toISOString() || data.checked_in_at || null,
      entry_point: data.entry_point || null,
      attendee_name: data.attendee_name || '',
      attendee_email: data.attendee_email || '',
      qr_code: data.qr_code || doc.id,
      purchased_at: data.purchased_at?.toDate?.()?.toISOString() || data.purchased_at || null,
    }
  })

  const event = {
    id: eventId,
    title: eventData?.title || '',
    start_datetime: eventData?.start_datetime?.toDate?.()?.toISOString() || eventData?.start_datetime || '',
    organizer_id: eventData?.organizer_id || '',
  }

  return <CheckInInterface event={event} tickets={tickets} onCheckIn={checkInTicket} />
}
