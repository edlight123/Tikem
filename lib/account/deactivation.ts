import { adminDb } from '@/lib/firebase/admin'
import { findActiveObligations } from '@/lib/account/deletion'

/**
 * Organizer account deactivation: an honest, reversible pause.
 *
 * Deactivating unpublishes the organizer's upcoming published events and
 * records EXACTLY which ones on the user doc, so reactivating can put back
 * those events and no others (an event the organizer had already unpublished
 * stays unpublished). It is refused while any upcoming event has sold tickets:
 * attendees hold those tickets, and hiding the event would strand them.
 *
 * Nothing purges a deactivated account on a timer. It stays deactivated until
 * the owner reactivates it or deletes it (lib/account/deletion.ts).
 */

export interface DeactivationRecord {
  at: string
  unpublished_event_ids: string[]
}

export type DeactivateOutcome =
  | { status: 'deactivated'; unpublishedEventIds: string[] }
  | { status: 'refused'; events: Array<{ id: string; title: string; ticketsSold: number }> }

function toMillis(value: any): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (typeof value?._seconds === 'number') return value._seconds * 1000
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : null
}

export async function deactivateOrganizerAccount(uid: string, now = new Date()): Promise<DeactivateOutcome> {
  const nowMs = now.getTime()
  const nowIso = now.toISOString()

  const obligations = await findActiveObligations(uid, nowMs)
  const withSales = obligations.find((o) => o.type === 'upcoming_events_with_sales')
  if (withSales && withSales.type === 'upcoming_events_with_sales') {
    return { status: 'refused', events: withSales.events }
  }

  const eventsSnap = await adminDb.collection('events').where('organizer_id', '==', uid).get()
  const toUnpublish = eventsSnap.docs.filter((d: any) => {
    const e = d.data() || {}
    if (e.is_published !== true) return false
    if (String(e.status || '').toLowerCase() === 'cancelled') return false
    const endsAt = toMillis(e.end_datetime) ?? toMillis(e.start_datetime)
    return endsAt == null || endsAt >= nowMs
  })

  const ids: string[] = []
  for (let i = 0; i < toUnpublish.length; i += 400) {
    const batch = adminDb.batch()
    for (const d of toUnpublish.slice(i, i + 400)) {
      batch.update(d.ref, {
        is_published: false,
        unpublished_by_deactivation: true,
        unpublished_at: nowIso,
        updated_at: nowIso,
      })
      ids.push(d.id)
    }
    await batch.commit()
  }

  const record: DeactivationRecord = { at: nowIso, unpublished_event_ids: ids }
  await adminDb.collection('users').doc(uid).set(
    {
      account_status: 'deactivated',
      deactivated_at: nowIso,
      deactivation: record,
      // An older version promised a 30-day deadline nothing enforced.
      reactivation_deadline: null,
      updated_at: nowIso,
    },
    { merge: true }
  )

  return { status: 'deactivated', unpublishedEventIds: ids }
}

/** The account's deactivation, or null when it is active. */
export async function getDeactivation(uid: string): Promise<DeactivationRecord | null> {
  const snap = await adminDb.collection('users').doc(uid).get()
  const data = snap.exists ? snap.data() || {} : {}
  if (data.account_status !== 'deactivated') return null
  const rec = data.deactivation || {}
  return {
    at: String(rec.at || data.deactivated_at || ''),
    unpublished_event_ids: Array.isArray(rec.unpublished_event_ids) ? rec.unpublished_event_ids.map(String) : [],
  }
}

/**
 * Put back exactly the events deactivation unpublished. An event someone has
 * since changed (deleted, cancelled, or no longer carrying the marker) is left
 * alone.
 */
export async function reactivateOrganizerAccount(uid: string, now = new Date()): Promise<{ restoredEventIds: string[] }> {
  const nowIso = now.toISOString()
  const rec = await getDeactivation(uid)
  const restored: string[] = []
  const owner = (await adminDb.collection('users').doc(uid).get()).data() || {}
  const banned = owner.status === 'banned' || owner.banned === true || owner.account_status === 'banned'

  for (const id of rec?.unpublished_event_ids || []) {
    const ref = adminDb.collection('events').doc(id)
    const snap = await ref.get()
    if (!snap.exists) continue
    const e = snap.data() || {}
    if (e.organizer_id !== uid) continue
    if (e.unpublished_by_deactivation !== true) continue
    if (String(e.status || '').toLowerCase() === 'cancelled') continue
    // Never undo moderation: an event rejected, held for review, frozen or
    // cancelled by an admin while the account was away stays down.
    if (
      e.rejected === true ||
      e.hidden_pending_review === true ||
      e.payouts_frozen === true ||
      e.cancelled_by_admin ||
      e.moderation_status === 'rejected' ||
      e.moderation_status === 'removed'
    ) {
      continue
    }
    // Banned or suspended accounts do not get their events back by reactivating.
    if (banned) continue
    await ref.update({
      is_published: true,
      unpublished_by_deactivation: false,
      updated_at: nowIso,
    })
    restored.push(id)
  }

  await adminDb.collection('users').doc(uid).set(
    {
      account_status: 'active',
      deactivated_at: null,
      deactivation: null,
      reactivation_deadline: null,
      reactivated_at: nowIso,
      updated_at: nowIso,
    },
    { merge: true }
  )
  return { restoredEventIds: restored }
}
