import { T } from '@/components/organizer/ui/TranslatedText'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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
  
  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect(`/auth/login?redirect=${encodeURIComponent(`/organizer/events/${eventId}/check-in`)}`)
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect(`/auth/login?redirect=${encodeURIComponent(`/organizer/events/${eventId}/check-in`)}`)
  }

  // Fetch event details
  const eventDoc = await adminDb.collection('events').doc(eventId).get()

  if (!eventDoc.exists) {
    redirect('/organizer/events')
  }

  const eventData = eventDoc.data()

  // Verify organizer access
  if (eventData?.organizer_id !== authUser.uid) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16">
        <div className="w-full rounded-2xl bg-white/[0.055] p-8 text-center">
          <h2 className="font-display text-2xl text-white mb-3"><T k="server_bits.unauthorized" /></h2>
          <p className="text-sm text-white/70">You don&apos;t have permission to run check-in for this event.</p>
          <Link
            href="/organizer/events"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          ><T k="server_bits.back_to_events" /></Link>
        </div>
      </div>
    )
  }

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
    id: eventDoc.id,
    title: eventData?.title || '',
    start_datetime: eventData?.start_datetime?.toDate?.()?.toISOString() || eventData?.start_datetime || '',
    organizer_id: eventData?.organizer_id || '',
  }

  return <CheckInInterface event={event} tickets={tickets} onCheckIn={checkInTicket} />
}
