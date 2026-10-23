/**
 * Server read for the /profile dashboard (Admin SDK, the signed-in reader's
 * OWN data only). Every number here has the same source the mobile
 * ProfileScreen uses, so the two profiles agree:
 *
 *  - following  organizer_follows where follower_id  == uid   (count)
 *  - followers  organizer_follows where organizer_id == uid   (count)
 *  - attended   live tickets (attendee_id OR user_id == uid) -> their events,
 *               counted when the event has ended
 *  - posters    those same events, newest first
 *  - org        public_profiles/{uid}.organization_* (canonical, both apps
 *               write it), falling back to the legacy users/organizers copies
 *               (lib/profile/org-brand.ts)
 *  - staff      members/{doc} with uid == uid and role == "staff"
 *               (the /staff page's own query)
 *
 * Every part fails soft: a failed read returns its empty value instead of
 * taking the whole profile page down.
 */

import { adminDb } from '@/lib/firebase/admin'
import { serializeData } from '@/lib/utils/serialize'
import { readOrgBrandAdmin } from '@/lib/firestore/org-brand-server'
import { countAttended, liveTicketEventIds, sortPostersNewestFirst } from './dashboard'

/** The poster grid shows this many; the rest are one tap away on /tickets. */
export const DASHBOARD_POSTER_LIMIT = 6

export interface ProfileDashboardData {
  stats: { attended: number; following: number; followers: number }
  /** Serialized event docs (Timestamps as ISO strings), newest first, capped. */
  posters: any[]
  /** Total ticketed events, so the grid can say there are more. */
  posterTotal: number
  organization: { name: string; logo: string }
  hasStaffAssignments: boolean
}

async function countWhere(field: string, uid: string): Promise<number> {
  try {
    const snap = await adminDb.collection('organizer_follows').where(field, '==', uid).count().get()
    return Number(snap.data().count) || 0
  } catch (err) {
    console.error(`[profile-dashboard] organizer_follows ${field} count failed`, err)
    return 0
  }
}

async function readTicketedEvents(uid: string): Promise<any[]> {
  try {
    // Tickets carry the owner as attendee_id on most rails and user_id on
    // others (and both on some); read both and de-duplicate by doc id.
    const [byAttendee, byUser] = await Promise.all([
      adminDb.collection('tickets').where('attendee_id', '==', uid).get(),
      adminDb.collection('tickets').where('user_id', '==', uid).get(),
    ])
    const byId = new Map<string, any>()
    for (const d of [...byAttendee.docs, ...byUser.docs]) byId.set(d.id, d.data())
    const eventIds = liveTicketEventIds(Array.from(byId.values()))
    if (!eventIds.length) return []

    const refs = eventIds.map((id) => adminDb.collection('events').doc(id))
    const events: any[] = []
    // getAll in modest batches: one round trip each instead of one per event.
    for (let i = 0; i < refs.length; i += 100) {
      const snaps = await adminDb.getAll(...refs.slice(i, i + 100))
      for (const s of snaps) {
        if (!s.exists) continue
        const data = s.data() || {}
        if (data.deleted || data.deleted_at) continue
        events.push({ id: s.id, ...data })
      }
    }
    return events
  } catch (err) {
    console.error('[profile-dashboard] ticketed events read failed', err)
    return []
  }
}

async function readOrganization(uid: string): Promise<{ name: string; logo: string }> {
  const brand = await readOrgBrandAdmin(uid)
  return { name: brand.organization_name, logo: brand.organization_logo }
}

async function readHasStaffAssignments(uid: string): Promise<boolean> {
  try {
    // uid + role, the /staff page's primary query (composite collection-group
    // index in firestore.indexes.json). A uid-only collection-group query has
    // NO index in prod (FAILED_PRECONDITION), so don't "simplify" to that.
    const snap = await adminDb
      .collectionGroup('members')
      .where('uid', '==', uid)
      .where('role', '==', 'staff')
      .limit(10)
      .get()
    return snap.docs.some((d: any) => Boolean(d.data()?.eventId))
  } catch (err) {
    console.error('[profile-dashboard] staff assignment read failed', err)
    return false
  }
}

export async function getProfileDashboardData(
  uid: string,
  opts: { includeOrganization: boolean }
): Promise<ProfileDashboardData> {
  const [following, followers, events, organization, hasStaffAssignments] = await Promise.all([
    countWhere('follower_id', uid),
    countWhere('organizer_id', uid),
    readTicketedEvents(uid),
    opts.includeOrganization ? readOrganization(uid) : Promise.resolve({ name: '', logo: '' }),
    readHasStaffAssignments(uid),
  ])

  const sorted = sortPostersNewestFirst(events)
  return {
    stats: { attended: countAttended(events), following, followers },
    posters: serializeData(sorted.slice(0, DASHBOARD_POSTER_LIMIT)),
    posterTotal: sorted.length,
    organization,
    hasStaffAssignments,
  }
}
