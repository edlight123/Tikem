import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { DoorModeInterface } from '@/components/scan/DoorModeInterface'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { isLiveTicketStatus } from '@/lib/tickets/status'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DoorModeScanPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect(`/auth/login?redirect=/organizer/scan/${eventId}`)
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect(`/auth/login?redirect=/organizer/scan/${eventId}`)
  }

  // Allow either event owner (organizer) or event-scoped staff with check-in permission.
  const userDoc = await adminDb.collection('users').doc(authUser.uid).get()
  const userRole = userDoc.exists ? userDoc.data()?.role : null

  // Fetch event
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  
  if (!eventDoc.exists) {
    notFound()
  }

  const eventData = eventDoc.data()
  const event = {
    id: eventDoc.id,
    title: eventData.title,
    organizer_id: eventData.organizer_id,
    start_datetime: eventData.start_datetime?.toDate?.()?.toISOString() || eventData.start_datetime,
    end_datetime: eventData.end_datetime?.toDate?.()?.toISOString() || eventData.end_datetime,
    venue_name: eventData.venue_name,
    city: eventData.city,
    entry_points: eventData.entry_points
  }

  const isEventOrganizerOwner = event.organizer_id === authUser.uid

  let isEventStaff = false
  let canViewAttendees = false
  if (!isEventOrganizerOwner) {
    const memberSnap = await adminDb.collection('events').doc(eventId).collection('members').doc(authUser.uid).get()
    if (memberSnap.exists) {
      const member = memberSnap.data() as any
      isEventStaff = Boolean(member?.permissions?.checkin)
      canViewAttendees = Boolean(member?.permissions?.viewAttendees)
    }
  }

  if (!isEventOrganizerOwner && !isEventStaff) {
    // Keep existing organizer routes gated; staff should only land here via invite and direct link.
    redirect('/organizer/scan')
  }

  const exitHref = isEventOrganizerOwner ? `/organizer/events/${eventId}` : '/staff'

  // If not an organizer, still allow access for staff.
  if (!isEventOrganizerOwner && userRole !== 'organizer') {
    // ok
  }

  // Every LIVE ticket for this event (supports legacy `eventId` field too), plus
  // ones already checked in so the counts are right. This used to filter on
  // status 'confirmed' alone, which hid every Stripe sale (written 'valid') from
  // manual lookup and the remaining count.
  const ticketDocs = (await loadTicketDocsForEvent(eventId)).filter((doc: any) => {
    const data = doc.data() || {}
    return isLiveTicketStatus(data.status) || Boolean(data.checked_in || data.checked_in_at)
  })

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
        full_name: userData.full_name || '',
        ...(isEventOrganizerOwner || canViewAttendees
          ? {
              email: userData.email || '',
              phone_number: userData.phone_number || '',
            }
          : {}),
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
      price_paid: ticketData.price_paid || 0,
      checked_in: ticketData.checked_in || false,
      qr_code: ticketData.qr_code || ticketData.qr_code_data || '',
      attendee,
      purchased_at: ticketData.purchased_at?.toDate?.()?.toISOString() || ticketData.purchased_at || new Date().toISOString(),
      checked_in_at: ticketData.checked_in_at?.toDate?.()?.toISOString() || ticketData.checked_in_at || null,
      created_at: ticketData.created_at?.toDate?.()?.toISOString() || ticketData.created_at || new Date().toISOString(),
      updated_at: ticketData.updated_at?.toDate?.()?.toISOString() || ticketData.updated_at || new Date().toISOString(),
    }
  })

  // Get entry points from event or use defaults
  const entryPoints = event.entry_points || ['Main Entrance', 'VIP Entrance', 'Gate A', 'Gate B']

  return (
    <DoorModeInterface
      eventId={eventId}
      eventTitle={event.title}
      scannedBy={authUser.uid}
      tickets={tickets}
      defaultEntryPoints={entryPoints}
      exitHref={exitHref}
    />
  )
}
