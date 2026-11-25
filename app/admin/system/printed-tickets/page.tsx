import { requireDevTools } from '@/lib/auth'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'
import { systemTabs } from '../tabs'
import { PrintedTicketsAdmin } from './PrintedTicketsAdmin'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Printed tickets | Admin | Tikèm',
  description: 'Printing prices and the print room for organizer ticket batches',
}

/**
 * Printed tickets (lib/physical): the price list organizers are charged (Firestore
 * config/physical_tickets, audited on every save) and the print room, where a
 * paid batch's PDF is downloaded and moved through printing → ready.
 */
export default async function AdminPrintedTicketsPage() {
  const { error: devToolsError } = await requireDevTools()
  return (
    <ConsolePage title="System">
      <ConsoleTabs tabs={systemTabs(!devToolsError)} />
      <ConsoleCaption>
        What organizers pay per printed ticket, and the batches waiting to be printed. Price changes
        apply to the next order, never to a batch already ordered.
      </ConsoleCaption>
      <PrintedTicketsAdmin />
    </ConsolePage>
  )
}
