'use client'

import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { ActionCenter } from '@/components/organizer/ActionCenter'
import { SalesSnapshot } from '@/components/organizer/SalesSnapshot'
import OrganizerEventCard from '@/components/organizer/events-manager/OrganizerEventCard'
import { PayoutsWidget } from '@/components/organizer/PayoutsWidget'
import WelcomeDashboard from '@/components/organizer/WelcomeDashboard'
import { PageHeader, SectionHeader, OrgEmptyState } from '@/components/organizer/ui'
import Link from 'next/link'
import { CalendarPlus, AlertTriangle, RefreshCw } from 'lucide-react'

interface Alert {
  id: string
  type: 'draft' | 'low-sales' | 'payout' | 'verification'
  title: string
  description: string
  ctaText: string
  ctaHref: string
}

interface OrganizerDashboardClientProps {
  nextEvent: any
  alerts: Alert[]
  hasPayoutSetup: boolean
  payoutWidgetStatus: 'not-setup' | 'setup' | 'pending' | 'active'
  pendingBalance: number
  payoutCurrency: string
  salesData: any
  events: any[]
  eventStatsById: Record<string, { ticketsSold: number; revenueByCurrencyCents: Record<string, number> }>
  isVerified: boolean
  organizerName: string
  hasCreatedEvent: boolean
  loadError?: boolean
}

export default function OrganizerDashboardClient({
  nextEvent,
  alerts,
  hasPayoutSetup,
  payoutWidgetStatus,
  pendingBalance,
  payoutCurrency,
  salesData,
  events,
  eventStatsById,
  isVerified,
  organizerName,
  hasCreatedEvent,
  loadError = false
}: OrganizerDashboardClientProps) {
  const { t } = useTranslation('common')
  const router = useRouter()

  // If the dashboard data failed to load, show a recoverable error instead of
  // the new-organizer welcome screen (which would misrepresent a real account
  // as empty when the reads simply failed).
  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="mx-auto max-w-md rounded-2xl bg-white/[0.05] p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-300" />
          </div>
          <h1 className="font-display text-2xl text-white">{t('organizer.dashboard_error.title', { defaultValue: "We couldn't load your dashboard" })}</h1>
          <p className="mt-2 text-[15px] text-white/70">
            {t('organizer.dashboard_error.description', {
              defaultValue: 'Something went wrong fetching your events and sales. Your data is safe. Please try again.',
            })}
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <RefreshCw className="h-4 w-4" />
            {t('organizer.dashboard_error.retry', { defaultValue: 'Try again' })}
          </button>
          <p className="mt-4 text-sm text-white/70">
            <Link href="/organizer/events" className="text-white underline underline-offset-2 hover:text-white/80">
              {t('organizer.dashboard_error.go_to_events', { defaultValue: 'Go to your events' })}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  // Show welcome dashboard for new organizers (no events yet)
  const isNewOrganizer = !hasCreatedEvent

  if (isNewOrganizer) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <WelcomeDashboard
          organizerName={organizerName}
          hasCreatedEvent={hasCreatedEvent}
          isVerified={isVerified}
          hasPayoutSetup={hasPayoutSetup}
        />
      </div>
    )
  }

  // Dashboard shows a short snapshot — upcoming events first — not the whole catalog.
  const now = Date.now()
  const previewEvents = [...events]
    .sort((a: any, b: any) => {
      const ta = new Date(a?.start_datetime || 0).getTime()
      const tb = new Date(b?.start_datetime || 0).getTime()
      const aUp = ta >= now
      const bUp = tb >= now
      if (aUp && bUp) return ta - tb // soonest upcoming first
      if (aUp) return -1
      if (bUp) return 1
      return tb - ta // then most recent past
    })
    .slice(0, 6)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8">
      {/* Header */}
      <PageHeader
        eyebrow="Organizer"
        title={t('organizer.dashboard_title', { defaultValue: 'Dashboard' })}
        subtitle={t('organizer.dashboard_subtitle', { defaultValue: 'Your events, sales and payouts at a glance' })}
        actions={
          <Link
            href="/organizer/events/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-white/90 text-black rounded-full font-semibold transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <CalendarPlus className="w-4 h-4" />
            {t('organizer.create_event')}
          </Link>
        }
      />

      {/* Overview — key numbers first */}
      <SalesSnapshot data={salesData} currency={payoutCurrency} />

      {/* Action items + payouts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className={hasPayoutSetup ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <ActionCenter alerts={alerts} />
        </div>
        {hasPayoutSetup && (
          <div>
            <PayoutsWidget
              status={payoutWidgetStatus}
              pendingBalance={pendingBalance}
              currency={payoutCurrency}
            />
          </div>
        )}
      </div>

      {/* Events Grid */}
      <div>
        <SectionHeader
          title={t('organizer.your_events')}
          className="mb-5"
          actions={
            <Link
              href="/organizer/events"
              className="eyebrow inline-flex shrink-0 items-center gap-1 text-[11px] text-white/60 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t('organizer.view_all_events')} →
            </Link>
          }
        />

        {events.length > 0 ? (
          <div className="space-y-3">
            {previewEvents.map((event: any) => {
              const stats = eventStatsById[String(event.id)]
              const revenueByCurrencyCents: Record<string, number> = stats?.revenueByCurrencyCents || {}

              return (
                <OrganizerEventCard
                  key={event.id}
                  showNeedsAttention={false}
                  event={{
                    id: String(event.id),
                    title: String(event.title || ''),
                    banner_image_url: event.banner_image_url || undefined,
                    start_datetime: String(event.start_datetime || ''),
                    is_published: Boolean(event.is_published),
                    tickets_sold: stats?.ticketsSold ?? (Number(event.tickets_sold) || 0),
                    total_tickets: Number(event.total_tickets || event.max_attendees || 0),
                    city: event.city || undefined,
                    location_name: event.location_name || event.venue_name || undefined,
                    currency: event.currency || undefined,
                    revenueByCurrencyCents,
                    category: event.category || undefined,
                  }}
                />
              )
            })}
          </div>
        ) : (
          <OrgEmptyState
            icon={CalendarPlus}
            title={t('organizer.no_events.title')}
            description={t('organizer.no_events.description')}
            action={
              <Link
                href="/organizer/events/new"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 text-black rounded-full font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <CalendarPlus className="w-4 h-4" />
                {t('organizer.no_events.cta')}
              </Link>
            }
          />
        )}
      </div>
    </div>
  )
}
