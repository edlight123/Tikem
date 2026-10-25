import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import TrackingLinksClient from './TrackingLinksClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function TrackingLinksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/tracking`)
  const eventData = __event as { organizer_id?: string; title?: string }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <TrackingLinksClient
        eventId={eventId}
        eventTitle={eventData.title ?? ''}
      />
    </div>
  )
}
