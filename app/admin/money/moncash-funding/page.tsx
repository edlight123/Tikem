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
        page works out how much to top it up by, and produces the formal letter on company letterhead
        (PDF) and its cover email. Nothing here moves money or emails Digicel: you sign, attach and
        send it yourself, from the address Digicel recognises.
      </ConsoleCaption>
      <MoncashFundingClient />
    </ConsolePage>
  )
}
