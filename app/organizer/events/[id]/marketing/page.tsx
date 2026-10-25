import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { Megaphone } from 'lucide-react'
import EventMarketingClient from './EventMarketingClient'

export const revalidate = 30

export default async function EventMarketingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'view', `/organizer/events/${eventId}/marketing`)
  const eventData = __event

  // Fetch promo codes for this event
  let promoCodes: Array<{
    id: string
    code: string
    discount_type: string
    discount_value: number
    uses: number
    max_uses: number | null
    is_active: boolean
  }> = []

  try {
    const promoSnap = await adminDb
      .collection('promo_codes')
      .where('event_id', '==', eventId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()

    promoCodes = promoSnap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const d = doc.data()
      return {
        id: doc.id,
        code: String(d.code || ''),
        discount_type: String(d.discount_type || 'percentage'),
        discount_value: Number(d.discount_value || 0),
        uses: Number(d.uses || 0),
        max_uses: d.max_uses != null ? Number(d.max_uses) : null,
        is_active: Boolean(d.is_active ?? true),
      }
    })
  } catch {
    // promo codes collection may not exist yet
  }

  return (
    <EventMarketingClient
      eventId={eventId}
      eventTitle={String(eventData.title || '')}
      promoCodes={promoCodes}
    />
  )
}
