import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { normalizeCurrency } from '@/lib/money'
import { formatMoneyFromCents } from '@/lib/money'
import { ShoppingBag } from 'lucide-react'
import EventOrdersClient from './EventOrdersClient'

export const revalidate = 0

function serializeTs(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof (v as any).toDate === 'function') return (v as any).toDate().toISOString()
  return String(v)
}

export default async function EventOrdersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'view', `/organizer/events/${eventId}/orders`)
  const eventData = __event

  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')

  const ticketDocs = await loadTicketDocsForEvent(eventId)

  // Batch fetch attendees
  const attendeeIds = Array.from(
    new Set(ticketDocs.map((doc) => doc.data().attendee_id).filter(Boolean))
  )
  const attendeesMap = new Map<string, { name: string; email: string }>()

  if (attendeeIds.length > 0) {
    // Resolve users by document reference (getAll) rather than a
    // `where('__name__', 'in', chunk)` query: filtering on the documentId
    // requires Key values, not bare id strings, so passing plain ids throws
    // "__key__ filter value must be a Key" — which previously left this map
    // empty so every attendee name fell back to "Unknown". getAll takes plain
    // refs, has no 30-item cap, and returns missing docs with `exists === false`.
    const refs = (attendeeIds as string[]).map((id) => adminDb.collection('users').doc(id))
    const docs = await adminDb.getAll(...refs)
    docs.forEach((doc: any) => {
      if (!doc.exists) return
      const d = doc.data() as any
      attendeesMap.set(doc.id, {
        name: d.full_name || d.name || d.email || 'Unknown',
        email: d.email || '',
      })
    })
  }

  const orders = ticketDocs.map((doc) => {
    const d = doc.data()
    const attendeeId = String(d.attendee_id || '')
    const attendee = attendeesMap.get(attendeeId)
    const currency = normalizeCurrency(d.currency, eventCurrency)
    const cents = Math.round(Number(d.price_paid || 0) * 100)
    return {
      id: doc.id,
      attendeeName: attendee?.name || 'Unknown',
      attendeeEmail: attendee?.email || '',
      tierName: String(d.tier_name || 'General Admission'),
      amount: cents > 0 ? formatMoneyFromCents(cents, currency, 'en-US', { currencyDisplay: 'code' }) : 'Free',
      status: String(d.status || 'active'),
      purchasedAt: serializeTs(d.purchased_at),
      checkedInAt: serializeTs(d.checked_in_at),
    }
  })

  return <EventOrdersClient orders={orders} />
}
