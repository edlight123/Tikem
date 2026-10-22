import { T } from '@/components/organizer/ui/TranslatedText'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { AttendeesManager } from './AttendeesManager'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AttendeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params

  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect(`/auth/login?redirect=${encodeURIComponent(`/organizer/events/${eventId}/attendees`)}`)
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect(`/auth/login?redirect=${encodeURIComponent(`/organizer/events/${eventId}/attendees`)}`)
  }

  // Fetch event
  let eventDoc
  try {
    eventDoc = await adminDb.collection('events').doc(eventId).get()
  } catch (error) {
    console.error('Error fetching event:', error)
    notFound()
  }
  
  if (!eventDoc.exists) {
    notFound()
  }

  const eventData = eventDoc.data()
  const event = {
    id: eventDoc.id,
    title: eventData.title,
    organizer_id: eventData.organizer_id,
    start_datetime: eventData.start_datetime?.toDate?.()?.toISOString() || eventData.start_datetime,
    total_tickets: eventData.total_tickets,
    tickets_sold: eventData.tickets_sold
  }

  // Verify organizer
  if (event.organizer_id !== authUser.uid) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16">
        <div className="w-full rounded-2xl bg-white/[0.055] p-8 text-center">
          <h2 className="font-display text-2xl text-white mb-3"><T k="server_bits.unauthorized" /></h2>
          <p className="text-sm text-white/70">You don&apos;t have permission to manage this event&apos;s attendees.</p>
          <Link
            href="/organizer/events"
            className="mt-6 inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          ><T k="server_bits.back_to_events" /></Link>
        </div>
      </div>
    )
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

  // Batch fetch all attendee users (instead of N+1 queries)
  const attendeeIds = Array.from(new Set(
    ticketDocs
      .map((doc: any) => doc.data().attendee_id)
      .filter((id: string) => id)
  ))
  
  const attendeesMap = new Map<string, any>()
  
  if (attendeeIds.length > 0) {
    // Resolve users by document reference (getAll) rather than a
    // `where('__name__', 'in', chunk)` query: filtering on the documentId
    // requires Key values, not bare id strings, so passing plain ids throws
    // "__key__ filter value must be a Key" — which previously left this map
    // empty so every attendee name fell back to blank. getAll takes plain refs,
    // has no 30-item cap, and returns missing docs with `exists === false`.
    const refs = attendeeIds.map((id: any) => adminDb.collection('users').doc(id))
    const userDocs = await adminDb.getAll(...refs)

    userDocs.forEach((doc: any) => {
      if (!doc.exists) return
      const userData = doc.data()
      attendeesMap.set(doc.id, {
        id: doc.id,
        email: userData.email || '',
        full_name: userData.full_name || '',
        phone_number: userData.phone_number || ''
      })
    })
  }

  // Map tickets with pre-fetched attendee data (no more N+1)
  const tickets = ticketDocs.map((doc: any) => {
    const ticketData = doc.data()
    const attendee = ticketData.attendee_id ? attendeesMap.get(ticketData.attendee_id) || null : null

    return {
      id: doc.id,
      event_id: ticketData.event_id || ticketData.eventId || '',
      attendee_id: ticketData.attendee_id || '',
      status: ticketData.status || 'confirmed',
      ticket_type: ticketData.ticket_type || 'General Admission',
      ticket_tier_id: ticketData.ticket_tier_id || '',
      price_paid: ticketData.price_paid || 0,
      currency: ticketData.currency || null,
      quantity: ticketData.quantity || 1,
      checked_in: ticketData.checked_in || false,
      qr_code: ticketData.qr_code || ticketData.qr_code_data || '',
      qr_code_data: ticketData.qr_code_data || ticketData.qr_code || '',
      attendee,
      purchased_at: ticketData.purchased_at?.toDate?.()?.toISOString() || ticketData.purchased_at || new Date().toISOString(),
      checked_in_at: ticketData.checked_in_at?.toDate?.()?.toISOString() || ticketData.checked_in_at || null,
      created_at: ticketData.created_at?.toDate?.()?.toISOString() || ticketData.created_at || new Date().toISOString(),
      updated_at: ticketData.updated_at?.toDate?.()?.toISOString() || ticketData.updated_at || new Date().toISOString(),
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
