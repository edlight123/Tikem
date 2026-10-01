import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { notFound, redirect } from 'next/navigation'
import { serializeGuest } from '@/lib/guest-list'
import GuestListClient from './GuestListClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function GuestListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { user, error } = await requireAuth('organizer')

  if (error || !user) {
    redirect(`/auth/login?redirect=/organizer/events/${eventId}/guest-list`)
  }

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) notFound()

  const eventData = eventDoc.data() as { organizer_id?: string; title?: string }
  if (eventData?.organizer_id !== user.id) notFound()

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
