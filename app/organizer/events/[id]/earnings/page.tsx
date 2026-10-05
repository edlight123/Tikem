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
import { fetchUsdToHtgRate } from '@/lib/currency'
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
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <h2 className="font-display text-2xl text-white mb-3"><T k="server_bits.event_not_found" /></h2>
          <p className="text-sm text-white/70"><T k="server_bits.event_deleted_or_wrong_link" /></p>
          <Link
            href="/organizer/events"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <T k="server_bits.back_to_events" />
          </Link>
        </div>
      </div>
    )
  }

  const eventData = eventDoc.data()

  // Check ownership
  if (eventData?.organizer_id !== user.id) {
    redirect('/organizer')
  }

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
    moncashMinimum = moncashMinimumInfo(cur, cur === 'USD' ? await fetchUsdToHtgRate() : 1)
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
      organizerId={user.id}
      tierBreakdown={tierBreakdown}
      moncashMinimum={moncashMinimum}
    />
  )
}
