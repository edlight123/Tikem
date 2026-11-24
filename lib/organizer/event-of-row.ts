/**
 * The parent event of a child row (session, recurring instance, photo), read
 * straight from events/{id} for an authorization check.
 *
 * The Firestore shim does not resolve Supabase-style joins such as
 * `select('*, events!inner(organizer_id)')`, so `row.events` is undefined and
 * canOnEvent(user, row.events, ...) refused every organizer (only platform
 * admins passed). Authorize against the real event document instead.
 */
import { adminDb } from '@/lib/firebase/admin'

export async function eventOfRow(row: Record<string, any> | null | undefined): Promise<Record<string, any> | null> {
  const id = String(row?.event_id || row?.parent_event_id || '').trim()
  if (!id || id.includes('/')) return null
  const snap = await adminDb.collection('events').doc(id).get()
  return snap.exists ? { id: snap.id, ...(snap.data() || {}) } : null
}
