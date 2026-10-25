import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import CompsClient from './CompsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CompsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/comps`)
  const eventData = __event as { organizer_id?: string; title?: string }

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
      // The comps route writes tier_name / comp_note (lib/tickets/compIssue.ts).
      ticket_type: String(d.tier_name || d.ticket_type || 'General Admission'),
      quantity: (d.quantity as number) || 1,
      note: String(d.comp_note || d.note || ''),
      status: String(d.status || 'valid').toLowerCase(),
      checked_in: d.checked_in === true || Boolean(d.checked_in_at),
      created_at: d.created_at?.toDate?.()?.toISOString() ?? null,
    }
  })

  // Tiers live in their own collection (the event doc has no ticket_tiers).
  const tiersSnap = await adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get()
  const tiers: Array<{ id: string; name: string }> = tiersSnap.docs
    .map((doc: QueryDocumentSnapshot) => ({ id: doc.id, ...(doc.data() as any) }))
    .sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((t: any) => ({ id: String(t.id), name: String(t.name || 'Ticket') }))

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
