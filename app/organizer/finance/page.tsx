import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { summaryFromAvailability } from '@/lib/payouts/availability'
import { PageHeader } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import EarningsView from '../earnings/EarningsView'
import Link from 'next/link'

export const revalidate = 0

export const metadata = {
  title: 'Finance | Tikèm',
  description: 'Track your event revenue and manage payouts',
}

export default async function FinancePage() {
  const { user, error } = await requireAuth()
  if (error || !user) redirect('/auth/login?redirect=/organizer/finance')

  const userDoc = await adminDb.collection('users').doc(user.id).get()
  const role = userDoc.exists ? userDoc.data()?.role : null
  if (role !== 'organizer') redirect('/organizer?redirect=/organizer/finance')

  // ONE source of truth for every money figure on this page: the shared
  // availability function (lib/payouts/availability.ts) that
  // /api/organizer/request-payout, withdraw-moncash and withdraw-bank all
  // validate with. The page used to mix the event_earnings aggregate (history,
  // including a row for an event no longer in the account) with a second,
  // tickets-based engine — and showed 2,250.00 HTG available while every
  // withdrawal was refused. Totals stay per currency; HTG and USD are never
  // added together.
  const availability = await loadOrganizerAvailability(user.id)
  const summary = summaryFromAvailability(availability.events)

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <TranslatedPageHeader
          eyebrowKey="organizer"
          titleKey="finance_title"
          subtitleKey="finance_subtitle"
          actions={
            <Link
              href="/organizer/settings/payouts"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-white/[0.08] px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
            >
              Payout settings
            </Link>
          }
        />

        <div className="mt-8">
          <EarningsView
            summary={summary}
            organizerId={user.id}
            withdrawable={{ totals: availability.totals }}
          />
        </div>
      </div>
    </div>
  )
}
