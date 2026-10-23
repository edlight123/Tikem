/**
 * Server read for the /profile "Following" panel (Admin SDK). Only ever called
 * with the signed-in reader's own uid: it lists the organizers THEY follow.
 * Who follows the reader stays a count only, for privacy.
 */

import { adminDb } from '@/lib/firebase/admin'
import {
  FOLLOWING_MAX_SCAN,
  orderFollowedOrganizerIds,
  pageOfIds,
  toFollowedOrganizer,
  type FollowingPage,
} from './following'

export async function getFollowingPage(uid: string, offset: number, limit: number): Promise<FollowingPage> {
  const snap = await adminDb
    .collection('organizer_follows')
    .where('follower_id', '==', uid)
    .limit(FOLLOWING_MAX_SCAN)
    .get()
  const ids = orderFollowedOrganizerIds(snap.docs.map((d: any) => d.data() || {}))
  const page = pageOfIds(ids, offset, limit)
  if (!page.ids.length) return { items: [], total: ids.length, nextOffset: null }

  // public_profiles is the cross-user-safe projection the event pages and
  // search read; users/{id} is owner-only.
  const snaps = await adminDb.getAll(...page.ids.map((id) => adminDb.collection('public_profiles').doc(id)))
  const items = snaps.map((s: any, i: number) => toFollowedOrganizer(page.ids[i], s?.exists ? s.data() : null))
  return { items, total: ids.length, nextOffset: page.nextOffset }
}
