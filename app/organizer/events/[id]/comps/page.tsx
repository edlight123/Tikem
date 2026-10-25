import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import CompsClient from './CompsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CompsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/comps`)
  const eventData = __event as {
    organizer_id?: string
    title?: string
    ticket_tiers?: Array<{ id: string; name: string; price: number }>
  }

  // Fetch comp tickets: tickets with price_paid = 0 and source = 'comp'
  const compsSnap = await adminDb
    .collection('tickets')
    .where('event_id', '==', eventId)
    .where('source', '==', 'comp')
    .orderBy('created_at', 'desc')
    .get()

  const comps = compsSnap.docs.map((doc: QueryDocumentSnapshot) => {
    const d = doc.data()
    return {
      id: doc.id,
      recipient_name: (d.recipient_name as string) || '',
      recipient_email: (d.recipient_email as string) || '',
      ticket_type: (d.ticket_type as string) || 'General Admission',
      quantity: (d.quantity as number) || 1,
      note: (d.note as string) || '',
      status: (d.status as string) || 'issued',
      created_at: d.created_at?.toDate?.()?.toISOString() ?? null,
    }
  })

  const tiers: Array<{ id: string; name: string }> =
    (eventData.ticket_tiers ?? []).map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <CompsClient
        eventId={eventId}
        eventTitle={eventData.title ?? ''}
        comps={comps}
        tiers={tiers}
      />
    </div>
  )
}
