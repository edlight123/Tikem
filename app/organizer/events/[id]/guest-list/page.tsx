import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { serializeGuest } from '@/lib/guest-list'
import GuestListClient from './GuestListClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function GuestListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/guest-list`)
  const eventData = __event as { organizer_id?: string; title?: string }

  // Fetch guest list entries (event sub-collection: events/{id}/guests)
  const guestsSnap = await adminDb
    .collection('events')
    .doc(eventId)
    .collection('guests')
    .orderBy('invited_at', 'desc')
    .get()

  const guests = guestsSnap.docs.map((doc: QueryDocumentSnapshot) => serializeGuest(doc.id, doc.data()))

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <GuestListClient
        eventId={eventId}
        eventTitle={eventData.title ?? ''}
        guests={guests}
      />
    </div>
  )
}
