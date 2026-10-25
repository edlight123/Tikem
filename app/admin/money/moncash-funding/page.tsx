import { MONEY_TABS } from '../tabs'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'
import { MoncashFundingClient } from './MoncashFundingClient'

export const metadata = {
  title: 'MonCash Funding | Admin | Tikèm',
  description: 'How much to move from the MonCash merchant account into the prefunded payout pool',
}

export const dynamic = 'force-dynamic'

export default function AdminMoncashFundingPage() {
  return (
    <ConsolePage title="Money">
      <ConsoleTabs tabs={MONEY_TABS} />
      <ConsoleCaption>
        Organizer MonCash payouts are sent from the prefunded pool (PANTHEON SERVICES PREFUNDED). This
        page works out how much to ask Digicel to move into it from the merchant account, and drafts
        the request. Nothing here moves money or emails Digicel: you send the request yourself.
      </ConsoleCaption>
      <MoncashFundingClient />
    </ConsolePage>
  )
}
