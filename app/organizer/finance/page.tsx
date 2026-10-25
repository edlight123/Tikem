import { requireFinancePage } from '../_lib/orgPage'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { summaryFromAvailability } from '@/lib/payouts/availability'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import { T } from '@/components/organizer/ui/TranslatedText'
import EarningsView from '../earnings/EarningsView'
import FinancePayoutHistory from './FinancePayoutHistory'
import Link from 'next/link'

export const revalidate = 0

export const metadata = {
  title: 'Finance | Tikèm',
  description: 'Track your event revenue and manage payouts',
}

export default async function FinancePage() {
  // The owner, or an admin the owner granted read-only finances (who sees the
  // figures with no withdraw or payout-settings actions). Others: /organizer.
  const { orgId, isOwner } = await requireFinancePage('/organizer/finance')

  // ONE source of truth for every money figure on this page: the shared
  // availability function (lib/payouts/availability.ts) that
  // the per-event withdraw-moncash and withdraw-bank routes
  // validate with. The page used to mix the event_earnings aggregate (history,
  // including a row for an event no longer in the account) with a second,
  // tickets-based engine — and showed 2,250.00 HTG available while every
  // withdrawal was refused. Totals stay per currency; HTG and USD are never
  // added together.
  const [availability, payouts] = await Promise.all([
    loadOrganizerAvailability(orgId),
    getPayoutHistory(orgId, 10).catch(() => []),
  ])
  const summary = summaryFromAvailability(availability.events)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <TranslatedPageHeader
          eyebrowKey="organizer"
          titleKey="finance_title"
          subtitleKey="finance_subtitle"
          actions={
            isOwner ? (
              <Link
                href="/organizer/settings/payouts"
                className="inline-flex h-11 items-center gap-2 rounded bg-white/[0.08] px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
              >
                <T k="finance_view.payout_settings" />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-white/60">
                <span className="h-2 w-2 rounded-full bg-white/50" aria-hidden />
                <T k="finance_view.read_only_label" />
              </span>
            )
          }
        />

        <div className="mt-8">
          <EarningsView
            summary={summary}
            organizerId={orgId}
            withdrawable={{ totals: availability.totals }}
            readOnly={!isOwner}
          />
          <FinancePayoutHistory
            payouts={payouts.map((p) => ({
              id: p.id,
              amount: p.amount,
              currency: String(p.currency || 'HTG'),
              status: p.status,
              method: p.method,
              createdAt: p.createdAt,
            }))}
          />
        </div>
      </div>
    </div>
  )
}
