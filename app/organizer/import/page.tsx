import { requireOrgPage } from '../_lib/orgPage'
import { eventbriteConfigured } from '@/lib/import/eventbrite-server'
import ImportClient from './ImportClient'

export const dynamic = 'force-dynamic'

/** Bring events over from Eventbrite, Luma, Meetup or any event page. */
export default async function ImportEventsPage() {
  await requireOrgPage('manage_events', '/organizer/import')
  // Connect Eventbrite shows only once the owner has created the Eventbrite
  // app (EVENTBRITE_CLIENT_ID / _SECRET + INTEGRATIONS_ENCRYPTION_KEY).
  return <ImportClient eventbriteAvailable={eventbriteConfigured()} />
}
