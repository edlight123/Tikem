import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import PrintedClient from './PrintedClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Printed tickets for one event (lib/physical): order a printed batch for one
 * ticket type (paid upfront), then run it: assign serial ranges to sellers,
 * void a lost range, give unsold seats back to online sales, and watch printed /
 * sold / checked-in counts per seller.
 */
export default async function PrintedTicketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/printed`)

  const tiersSnap = await adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get()
  const tiers = tiersSnap.docs
    .map((doc: any) => ({ id: String(doc.id), ...(doc.data() || {}) }))
    .sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((t: any) => {
      const cap = Number(t.total_quantity ?? t.quantity ?? 0)
      const sold = Number(t.sold_quantity ?? 0)
      return {
        id: String(t.id),
        name: String(t.name || 'Ticket'),
        price: Number(t.price) || 0,
        remaining: cap > 0 ? Math.max(0, cap - sold) : null,
      }
    })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PrintedClient
        eventId={eventId}
        currency={String((event as any)?.currency || 'HTG').toUpperCase()}
        tiers={tiers}
      />
    </div>
  )
}
