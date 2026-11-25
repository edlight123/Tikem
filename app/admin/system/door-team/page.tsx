import { requireDevTools } from '@/lib/auth'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'
import { systemTabs } from '../tabs'
import { DoorTeamAdmin } from './DoorTeamAdmin'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Door team | Admin | Tikèm',
  description: 'Door team prices and the queue of organizer requests',
}

/**
 * Door team (lib/doorTeam): the standard price list organizers are quoted
 * (Firestore config/door_team, audited on every save) and the request queue,
 * where a request is quoted (standard or negotiated), declined, staffed with
 * Tikèm crew accounts, confirmed and closed.
 */
export default async function AdminDoorTeamPage() {
  const { error: devToolsError } = await requireDevTools()
  return (
    <ConsolePage title="System">
      <ConsoleTabs tabs={systemTabs(!devToolsError)} />
      <ConsoleCaption>
        What organizers are quoted for Tikèm&apos;s door crew, and the requests waiting on us. A negotiated
        price needs a note; every action is audited.
      </ConsoleCaption>
      <DoorTeamAdmin />
    </ConsolePage>
  )
}
