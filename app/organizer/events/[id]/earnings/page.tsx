import { T } from '@/components/organizer/ui/TranslatedText'
import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { adminDb } from '@/lib/firebase/admin'
import { getEventTierSalesBreakdown } from '@/lib/earnings'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { toEarningsRow } from '@/lib/payouts/availability'
import { calculateFees } from '@/lib/fees'
import EventEarningsView from './EventEarningsView'
import { isAdmin } from '@/lib/admin'
import { canViewEventFinances } from '@/lib/organizer/financeAccess'
import { getUsdToHtgBaseRate } from '@/lib/fx/usd-htg'
import { moncashMinimumInfo, type MoncashMinimumInfo } from '@/lib/payouts/moncash-withdrawal-minimum'

export const revalidate = 30

export const metadata = {
  title: 'Event Earnings - Tikèm',
  description: 'View earnings and request withdrawal for your event'
}

export default async function EventEarningsPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { user, error } = await requireAuth()
  const { id: eventId } = await params

  if (error || !user) {
    redirect(`/auth/login?redirect=/organizer/events/${eventId}/earnings`)
  }

  // Fetch event details
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16">
        <div className="w-full rounded-2xl bg-white/[0.055] p-8 text-center">
          <h2 className="font-display lowercase italic !text-[26px] !leading-snug text-white mb-3"><T k="server_bits.event_not_found" /></h2>
          <p className="text-sm text-white/70"><T k="server_bits.event_deleted_or_wrong_link" /></p>
          <Link
            href="/organizer/events"
            className="mt-6 inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <T k="server_bits.back_to_events" />
          </Link>
        </div>
      </div>
    )
  }

  const eventData = eventDoc.data()

  // Figures: the owner, an admin the owner granted read-only finances, or a
  // platform admin. Withdrawals stay the owner's (the withdraw routes enforce
  // it too); everyone else goes back to the event overview.
  if (!(await canViewEventFinances(user, eventData))) {
    redirect(`/organizer/events/${eventId}`)
  }
  const ownerOrgId = String(eventData?.organizer_id || eventData?.organizerId || '')
  const readOnly = ownerOrgId !== user.id

  // Fetch earnings
  // The money figures come from the shared availability function — the same
  // call the withdraw routes validate with — so the amount this page offers is
  // the amount a withdrawal will accept. Null when nothing has sold.
  const availability = await loadEventAvailability({ eventId, eventData })
  const earnings =
    availability &&
    (availability.ticketsSold > 0 || availability.withdrawnMinor > 0 || availability.batchReservedMinor > 0)
      ? toEarningsRow(availability)
      : null

  const tierBreakdown = await getEventTierSalesBreakdown(eventId)

  // The MonCash floor (1,000 HTG) in this event's currency, at the rate the
  // withdrawal route would convert with. Null = unknown; the route still enforces it.
  let moncashMinimum: MoncashMinimumInfo | null = null
  try {
    const cur = String(earnings?.currency || 'HTG').toUpperCase()
    moncashMinimum = moncashMinimumInfo(cur, cur === 'USD' ? (await getUsdToHtgBaseRate({ fallback: 'lowest' })).baseRate : 1)
  } catch {
    moncashMinimum = null
  }

  // Serialize Firestore timestamps
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

  const serializedEvent = serializeData({
    id: eventDoc.id,
    ...eventData
  })

  const serializedEarnings = serializeData(earnings)

  return (
    <EventEarningsView
      event={serializedEvent}
      earnings={serializedEarnings}
      organizerId={String(eventData?.organizer_id || user.id)}
      tierBreakdown={tierBreakdown}
      moncashMinimum={moncashMinimum}
      readOnly={readOnly}
    />
  )
}
