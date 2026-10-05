import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { redirect } from 'next/navigation'
import { getOrganizerStats, getNextEvent } from '@/lib/firestore/organizer'
import { normalizeCurrency } from '@/lib/money'
import {
  determinePayoutStatus,
  getOrganizerIdentityVerificationStatus,
  hasPayoutMethod,
} from '@/lib/firestore/payout'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import OrganizerDashboardClient from './OrganizerDashboardClient'
import OrganizerUpgradePrompt from './OrganizerUpgradePrompt'

export const revalidate = 30 // Cache for 30 seconds

// Depends on auth cookies and organizer-specific data.
export const dynamic = 'force-dynamic'

function sanitizeRedirectTarget(target: string | undefined): string {
  if (!target) return '/organizer'
  if (!target.startsWith('/')) return '/organizer'
  if (target.startsWith('//')) return '/organizer'
  return target
}

export default async function OrganizerDashboard({
  searchParams
}: {
  // Next 15: searchParams is a Promise.
  searchParams?: Promise<{ redirect?: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/organizer')
  }

  if (user.role !== 'organizer') {
    const redirectTo = sanitizeRedirectTarget((await searchParams)?.redirect)

    return <OrganizerUpgradePrompt redirectTo={redirectTo} />
  }

  // Safe empty defaults so a partial Firestore failure renders a recoverable
  // error state instead of masquerading as a brand-new (empty) organizer.
  const emptyStats: any = {
    draftEvents: 0,
    upcomingSoonWithNoSales: 0,
    upcomingEvents: 0,
    ticketsSold: 0,
    revenue: 0,
    revenueByCurrencyCents: {},
    avgTicketsPerEvent: 0,
    events: [],
    tickets: [],
  }

  // Fetch organizer data
  let loadError = false
  let nextEvent: any = null
  let stats7d: any = emptyStats
  let stats30d: any = emptyStats
  let statsLifetime: any = emptyStats
  let haitiProfile: any = null
  let stripeProfile: any = null
  let balanceData: any = { pending: 0, currency: 'HTG' }
  let identityStatus: any = 'unverified'

  try {
    ;[nextEvent, stats7d, stats30d, statsLifetime, haitiProfile, stripeProfile, balanceData, identityStatus] = await Promise.all([
      getNextEvent(user.id),
      getOrganizerStats(user.id, '7d'),
      getOrganizerStats(user.id, '30d'),
      getOrganizerStats(user.id, 'lifetime'),
      getPayoutProfile(user.id, 'haiti'),
      getPayoutProfile(user.id, 'stripe_connect'),
      // The shared availability (lib/payouts/availability.ts), reduced to ONE
      // currency's figure for the widget — never a sum across currencies.
      loadOrganizerAvailability(user.id).then(({ totals, events }) => {
        const primary = totals.find((t) => t.pendingMinor + t.availableNowMinor > 0) || totals[0]
        return { pending: primary?.pendingMinor ?? 0, currency: primary?.currency ?? events[0]?.currency ?? 'HTG' }
      }),
      getOrganizerIdentityVerificationStatus(user.id),
    ])
  } catch (err) {
    console.error('Organizer dashboard failed to load:', err)
    loadError = true
  }

  // Default to 7d stats
  const currentStats = stats7d

  const haitiHasMethod = hasPayoutMethod(haitiProfile)
  const stripeHasSetup = Boolean(stripeProfile?.stripeAccountId)
  const hasPayoutSetup = haitiHasMethod || stripeHasSetup
  const isVerified = identityStatus === 'verified'
  const payoutStatus = haitiHasMethod ? determinePayoutStatus(haitiProfile) : 'not_setup'
  const payoutWidgetStatus: 'not-setup' | 'setup' | 'pending' | 'active' = (() => {
    if (stripeHasSetup && !haitiHasMethod) return 'pending'
    switch (payoutStatus) {
      case 'active':
        return 'active'
      case 'pending_verification':
        return 'pending'
      case 'on_hold':
        return 'pending'
      default:
        return 'not-setup'
    }
  })()

  // Build alerts for Action Center
  const alerts: Array<{
    id: string
    type: 'draft' | 'low-sales' | 'payout' | 'verification'
    title: string
    description: string
    ctaText: string
    ctaHref: string
  }> = []

  if (currentStats.draftEvents > 0) {
    alerts.push({
      id: 'drafts',
      type: 'draft',
      title: `${currentStats.draftEvents} Draft Event${currentStats.draftEvents > 1 ? 's' : ''}`,
      description: 'Publish your events to start selling tickets',
      ctaText: 'Publish Events',
      ctaHref: '/organizer/events'
    })
  }

  if (currentStats.upcomingSoonWithNoSales > 0) {
    alerts.push({
      id: 'no-sales',
      type: 'low-sales',
      title: `${currentStats.upcomingSoonWithNoSales} Event${currentStats.upcomingSoonWithNoSales > 1 ? 's' : ''} Starting Soon`,
      description: 'These events start within 7 days with no sales yet',
      ctaText: 'Promote Events',
      ctaHref: '/organizer/events'
    })
  }

  if (!hasPayoutSetup) {
    alerts.push({
      id: 'payout-setup',
      type: 'payout',
      title: 'Payouts not set up',
      description: 'Connect your bank account to receive payments',
      ctaText: 'Setup Payouts',
      ctaHref: '/organizer/settings/payouts'
    })
  } else if (payoutWidgetStatus === 'pending') {
    alerts.push({
      id: 'payout-verification',
      type: 'payout',
      title: 'Payout verification pending',
      description: 'We are reviewing your payout details. Hang tight!',
      ctaText: 'View status',
      ctaHref: '/organizer/settings/payouts'
    })
  }

  if (!isVerified) {
    alerts.push({
      id: 'verification',
      type: 'verification',
      title: 'Verification Pending',
      description: 'Complete verification to unlock all features',
      ctaText: 'Complete Verification',
      ctaHref: '/organizer/verify'
    })
  }

  // Build sales snapshot data
  const salesData = {
    '7d': {
      upcomingEvents: stats7d.upcomingEvents,
      ticketsSold: stats7d.ticketsSold,
      revenueCents: stats7d.revenue,
      revenueByCurrencyCents: stats7d.revenueByCurrencyCents || {},
      avgTicketsPerEvent: stats7d.avgTicketsPerEvent
    },
    '30d': {
      upcomingEvents: stats30d.upcomingEvents,
      ticketsSold: stats30d.ticketsSold,
      revenueCents: stats30d.revenue,
      revenueByCurrencyCents: stats30d.revenueByCurrencyCents || {},
      avgTicketsPerEvent: stats30d.avgTicketsPerEvent
    },
    lifetime: {
      upcomingEvents: statsLifetime.upcomingEvents,
      ticketsSold: statsLifetime.ticketsSold,
      revenueCents: statsLifetime.revenue,
      revenueByCurrencyCents: statsLifetime.revenueByCurrencyCents || {},
      avgTicketsPerEvent: statsLifetime.avgTicketsPerEvent
    }
  }

  // Serialize all data before passing to client component
  const serializeData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString()
    if (Array.isArray(obj)) return obj.map(serializeData)
    
    const serialized: any = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        serialized[key] = serializeData(obj[key])
      }
    }
    return serialized
  }

  const serializedNextEvent = serializeData(nextEvent)
  const serializedEvents = serializeData(currentStats.events)

  // Build lifetime per-event stats for event cards (tickets sold + revenue) without shipping raw tickets
  // to the client. This avoids the dashboard cards showing only the current time-range totals.
  const eventStatsById: Record<
    string,
    { ticketsSold: number; revenueByCurrencyCents: Record<string, number> }
  > = {}

  for (const t of statsLifetime.tickets || []) {
    const eventId = String(t?.event_id || '')
    if (!eventId) continue
    if (String(t?.status || '').toLowerCase() !== 'valid') continue

    const currency = normalizeCurrency(t?.currency, 'HTG')
    const cents = Math.round((Number(t?.price_paid || 0) || 0) * 100)

    if (!eventStatsById[eventId]) {
      eventStatsById[eventId] = { ticketsSold: 0, revenueByCurrencyCents: {} }
    }

    eventStatsById[eventId].ticketsSold += 1
    eventStatsById[eventId].revenueByCurrencyCents[currency] =
      (eventStatsById[eventId].revenueByCurrencyCents[currency] || 0) + cents
  }

  // Determine if this is a new organizer (no events created yet)
  const hasCreatedEvent = (currentStats.events?.length ?? 0) > 0 || (statsLifetime.events?.length ?? 0) > 0

  return (
    <OrganizerDashboardClient
      nextEvent={serializedNextEvent}
      alerts={alerts}
      hasPayoutSetup={hasPayoutSetup}
      payoutWidgetStatus={payoutWidgetStatus}
      pendingBalance={balanceData.pending}
      payoutCurrency={balanceData.currency}
      salesData={salesData}
      events={serializedEvents}
      eventStatsById={eventStatsById}
      isVerified={isVerified}
      organizerName={user.name || user.email || ''}
      hasCreatedEvent={hasCreatedEvent}
      loadError={loadError}
    />
  )
}
