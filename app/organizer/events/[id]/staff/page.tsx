import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { isAdmin } from '@/lib/admin'
import EventStaffManager from './EventStaffManager'

export const revalidate = 0

export default async function EventStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { event: __event } = await requireEventPage(id, 'manage_events', `/organizer/events/${id}/staff`)
  const eventData = __event as any

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
      <EventStaffManager eventId={id} />
    </div>
  )
}
