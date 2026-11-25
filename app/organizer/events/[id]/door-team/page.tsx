import { requireEventPage } from '../../../_lib/orgPage'
import DoorTeamClient from './DoorTeamClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Door team for one event (lib/doorTeam): ask Tikèm for its own crew to scan
 * tickets at the door, see the standard quote, pay the quote Tikèm confirms
 * (MonCash, card, or a released balance), and follow the request to the crew's
 * first names and the event-day contact.
 */
export default async function DoorTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params
  await requireEventPage(eventId, 'manage_events', `/organizer/events/${eventId}/door-team`)
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <DoorTeamClient eventId={eventId} />
    </div>
  )
}
