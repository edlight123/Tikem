import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { normalizeCurrency } from '@/lib/money'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { buyerIdOf, isGuestTicket, toTicketRow, type EventTicketRow } from '@/lib/organizer/eventOrders'

export type EventAccess =
  | { ok: true; user: { id: string; email?: string; role?: string }; isAdmin: boolean; event: Record<string, any> & { id: string } }
  | { ok: false; status: number; error: string }

/**
 * The same gate the web's per-event organizer pages apply: signed in, and
 * either the event's organizer or a platform admin.
 */
export async function authorizeEventOwner(eventId: string): Promise<EventAccess> {
  if (!eventId) return { ok: false, status: 400, error: 'Event ID is required' }
  const user = await getCurrentUser()
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' }

  const isAdmin = user.role === 'admin' || user.role === 'super_admin' || isAdminEmail(user.email)
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) return { ok: false, status: 404, error: 'Event not found' }
  const event = { id: snap.id, ...(snap.data() as any) }
  if (event.organizer_id !== user.id && !isAdmin) {
    return { ok: false, status: 403, error: 'You do not own this event' }
  }
  return { ok: true, user, isAdmin, event }
}

/** Resolve buyer user docs by reference (getAll — no `in` cap, no Key-type trap). */
export async function loadProfiles(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('users').doc(id))
    if (refs.length === 0) continue
    const docs = await adminDb.getAll(...refs)
    for (const doc of docs as any[]) {
      if (doc.exists) out.set(doc.id, doc.data() || {})
    }
  }
  return out
}

/** Every ticket for the event, normalized, with buyer details resolved server-side. */
export async function loadEventTicketRows(event: Record<string, any> & { id: string }): Promise<EventTicketRow[]> {
  const eventCurrency = normalizeCurrency(event.currency, 'HTG')
  const docs = await loadTicketDocsForEvent(event.id)
  const datas = docs.map((doc) => ({ id: doc.id, data: (doc.data() || {}) as Record<string, any> }))
  const profiles = await loadProfiles(
    datas.filter(({ data }) => !isGuestTicket(data)).map(({ data }) => buyerIdOf(data))
  )
  return datas.map(({ id, data }) => toTicketRow(id, data, profiles.get(buyerIdOf(data)) || null, eventCurrency))
}
