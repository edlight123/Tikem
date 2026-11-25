import { MONEY_TABS } from '../tabs'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'
import { MoneyMapClient } from './MoneyMapClient'

export const metadata = {
  title: 'Money Map | Admin | Tikèm',
  description: 'Where ticket money sits, per rail and currency, and what Haiti organizers are owed',
}

export const dynamic = 'force-dynamic'

export default function AdminMoneyMapPage() {
  return (
    <ConsolePage title="Money">
      <ConsoleTabs tabs={MONEY_TABS} />
      <ConsoleCaption>
        Where buyers&apos; money sits, per rail and currency, less refunds and chargebacks, with every recorded
        movement applied. Record a movement or an organizer wire below; nothing here moves money.
      </ConsoleCaption>
      <MoneyMapClient />
    </ConsolePage>
  )
}
