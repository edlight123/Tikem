import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import PromotersClient from './PromotersClient'

export const dynamic = 'force-dynamic'

export default async function EventPromotersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/promoters`)
  const eventData = __event

  return (
    <PromotersClient
      eventId={eventId}
      eventTitle={String(eventData.title || '')}
      eventCurrency={String(eventData.currency || 'HTG').toUpperCase()}
    />
  )
}
