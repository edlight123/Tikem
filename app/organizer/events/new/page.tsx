import { requireOrgPage } from '../../_lib/orgPage'
import EventComposer from '../EventComposer'
import { createClient } from '@/lib/firebase-db/server'
import { getOrganizerVerificationStatus } from '@/lib/organizerVerification'
import { adminDb } from '@/lib/firebase/admin'
import { getDeclaredMarkets } from '@/lib/firestore/organizer-markets'
import { pickDefaultComposerCountry } from '@/lib/events/composer-country'

export const dynamic = 'force-dynamic'

/**
 * Where a NEW event starts: the organizer's first declared market, else their
 * stated default country (users doc — the mobile location banner — then the
 * organizer defaults page), else Haiti. Mirrors the mobile composer's seed.
 * A preference only: the organizer picks the country on the form, and the
 * publish gate always runs for the event's own country.
 */
async function startingLocation(userId: string): Promise<{ country: string; city?: string }> {
  try {
    const [markets, userSnap, orgSnap] = await Promise.all([
      getDeclaredMarkets(userId).catch(() => [] as string[]),
      adminDb.collection('users').doc(userId).get(),
      adminDb.collection('organizers').doc(userId).get(),
    ])
    const u = userSnap.exists ? (userSnap.data() as any) : null
    const o = orgSnap.exists ? (orgSnap.data() as any) : null
    const country = pickDefaultComposerCountry(markets[0], u?.default_country, o?.default_country)
    // The defaults page stores a city alongside its country; offer it only
    // when that country is the one the composer starts in.
    const city =
      o?.default_city && pickDefaultComposerCountry(o?.default_country) === country
        ? String(o.default_city)
        : undefined
    return { country, city }
  } catch {
    return { country: 'HT' }
  }
}

export default async function NewEventPage() {
  // Owner, or an admin/manager of the acting org: the new event belongs to
  // the org (organizer_id = orgId) and records who made it (created_by).
  const ctx = await requireOrgPage('manage_events', '/organizer/events/new')
  const orgId = ctx.orgId

  // Drafts are allowed for everyone; paid publishing is enforced later in the
  // full editor + API. Keep this first screen light and fast.
  await createClient() // Ensure server db is initialized for this request
  const [verification, start] = await Promise.all([
    getOrganizerVerificationStatus(orgId),
    startingLocation(orgId),
  ])

  return (
    <EventComposer
      userId={orgId}
      actorId={ctx.user.id}
      isVerified={verification.isVerified}
      defaultCountry={start.country}
      defaultCity={start.city}
    />
  )
}
