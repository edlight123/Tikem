import RefundQueue from './RefundQueue'
import { MONEY_TABS } from '../tabs'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'

export const metadata = {
  title: 'Manual Refunds | Admin | Tikèm',
  description: 'Mobile-money refunds and unhonored orders waiting on a manual payout',
}

// Read live in the client component; keep the shell dynamic-safe.
export const dynamic = 'force-dynamic'

export default async function AdminManualRefundsPage() {
  return (
    <ConsolePage title="Money">
      <ConsoleTabs tabs={MONEY_TABS} />
      <ConsoleCaption>
        Buyers owed money that only a person can send. MonCash, NatCash and SogePay have no refund
        API, so a refunded or cancelled mobile-money ticket lands here, as does any order that was
        paid but could not be honored. Pay the buyer outside Tikèm, then record it here. Refunds an
        organizer&apos;s remaining balance can&apos;t cover wait at the top for you to approve or deny.
      </ConsoleCaption>

      <RefundQueue />
    </ConsolePage>
  )
}
