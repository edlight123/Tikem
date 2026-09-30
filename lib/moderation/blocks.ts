/**
 * Blocking an organizer (App Store guideline 1.2: "block abusive users").
 *
 * Stored at users/{uid}/blocked_organizers/{organizerId} — owner-readable,
 * server-written only (firestore.rules). Blocking:
 *   - hides that organizer's events from the blocker's Home / Discover / Search /
 *     category feeds (web server-side via filterBlockedEvents; mobile in memory
 *     from the same subcollection),
 *   - removes the blocker's follow, so "new event from an organizer you follow"
 *     notifications stop, and re-following is refused while the block stands
 *     (the follow API checks, and firestore.rules refuses a client-side follow),
 *   - hides in-app notifications that carry that organizerId (client-side).
 * A direct link to one of their events still opens: blocking curates what you
 * are shown, it does not break a ticket you already hold.
 */
import { adminDb } from '@/lib/firebase/admin'

export const BLOCKED_ORGANIZERS_SUBCOLLECTION = 'blocked_organizers'

function blocksRef(uid: string) {
  return adminDb.collection('users').doc(uid).collection(BLOCKED_ORGANIZERS_SUBCOLLECTION)
}

export async function blockOrganizer(uid: string, organizerId: string, now = new Date()): Promise<void> {
  await blocksRef(uid).doc(organizerId).set({ organizer_id: organizerId, created_at: now })

  // Drop the follow (there may be legacy duplicates, so delete every match).
  const follows = await adminDb
    .collection('organizer_follows')
    .where('follower_id', '==', uid)
    .where('organizer_id', '==', organizerId)
    .get()
  if (!follows.empty) {
    const batch = adminDb.batch()
    follows.docs.forEach((d: any) => batch.delete(d.ref))
    await batch.commit()
  }
}

export async function unblockOrganizer(uid: string, organizerId: string): Promise<void> {
  await blocksRef(uid).doc(organizerId).delete()
}

export async function isOrganizerBlocked(uid: string | null | undefined, organizerId: string): Promise<boolean> {
  if (!uid || !organizerId) return false
  try {
    const snap = await blocksRef(uid).doc(organizerId).get()
    return snap.exists
  } catch (err) {
    console.error('[blocks] read failed', err)
    return false
  }
}

/** The blocker's blocked organizer ids. Empty (never throws) when signed out or on a read fault. */
export async function getBlockedOrganizerIds(uid: string | null | undefined): Promise<Set<string>> {
  if (!uid) return new Set()
  try {
    const snap = await blocksRef(uid).limit(1000).get()
    return new Set(snap.docs.map((d: any) => String(d.id)))
  } catch (err) {
    console.error('[blocks] list failed', err)
    return new Set()
  }
}

/** Drop events whose organizer the viewer blocked. Pure; exported for tests. */
export function filterBlockedEvents<T extends { organizer_id?: string | null }>(
  events: T[],
  blocked: Set<string> | ReadonlySet<string>
): T[] {
  if (!blocked || blocked.size === 0) return events
  return events.filter((e) => !(e?.organizer_id && blocked.has(String(e.organizer_id))))
}

/**
 * Discovery visibility for moderation: an event with `hidden_pending_review`
 * (auto-hidden after repeated reports) stays out of feeds until an admin
 * reviews it. Missing field = visible. Pure; exported for tests.
 */
export function isHiddenPendingReview(event: { hidden_pending_review?: boolean } | null | undefined): boolean {
  return (event as any)?.hidden_pending_review === true
}
