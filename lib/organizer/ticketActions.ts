import { adminDb } from '@/lib/firebase/admin'
import { authorizeEventOwner, type EventAccess } from '@/lib/organizer/eventOrdersLoader'

/**
 * Body + ownership handling shared by the organizer's per-ticket actions
 * (/api/resend-ticket, /api/refund-ticket). Accepts the web's `{ ticketId }`
 * and the mobile order view's `{ ticketIds }`; every ticket must belong to ONE
 * event the caller owns.
 */
export type LoadedTickets =
  | {
      ok: true
      access: Extract<EventAccess, { ok: true }>
      tickets: (Record<string, any> & { id: string })[]
    }
  | { ok: false; status: number; error: string }

export function parseTicketIds(body: any, max: number): string[] | null {
  const raw: unknown[] = Array.isArray(body?.ticketIds)
    ? body.ticketIds
    : body?.ticketId
      ? [body.ticketId]
      : []
  const ids = Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)))
  if (ids.length === 0 || ids.length > max) return null
  return ids
}

export async function loadOwnedTickets(ids: string[]): Promise<LoadedTickets> {
  const refs = ids.map((id) => adminDb.collection('tickets').doc(id))
  const snaps = (await adminDb.getAll(...refs)) as any[]
  const tickets = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...(s.data() as any) }))
  if (tickets.length !== ids.length) return { ok: false, status: 404, error: 'Ticket not found' }

  const eventIds = new Set(tickets.map((t) => String(t.event_id || t.eventId || '')))
  if (eventIds.size !== 1 || eventIds.has('')) {
    return { ok: false, status: 400, error: 'Tickets must belong to one event' }
  }

  const access = await authorizeEventOwner(Array.from(eventIds)[0])
  if (!access.ok) return access
  return { ok: true, access, tickets }
}
