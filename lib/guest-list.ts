// Organizer guest list: the events/{eventId}/guests sub-collection.
//
// One shape, read by the web page (app/organizer/events/[id]/guest-list) and the
// API that both the web drawer and the mobile screen write through. Keep the
// field names here in step with the page's own serializer.
//
// Adding a guest issues real free tickets through the comps path
// (lib/tickets/compIssue.ts): one ticket, two with a +1. The guest doc keeps
// their ids (`ticket_ids`), so check-in state is read from the tickets the door
// scanned, not only from the hand-ticked flag.

export interface GuestRecord {
  id: string
  name: string
  email: string
  status: string
  plus_one: boolean
  invited_at: string | null
  checked_in: boolean
  ticket_ids: string[]
  /** none: added before guests got tickets; issued: at least one live ticket; cancelled: none live. */
  ticket_status: 'none' | 'issued' | 'cancelled'
  /** How many of the guest's tickets have been scanned or ticked in. */
  checked_in_count: number
  /** True when the ticket email went out. */
  email_sent: boolean
  /** A shareable link to the ticket (server-computed; null when there is none). */
  ticket_link: string | null
}

/** The bits of a ticket doc the guest list reads. */
export interface GuestTicketState {
  id: string
  status: string
  checked_in: boolean
}

const LIVE = new Set(['valid', 'confirmed', 'active', 'checked_in', ''])

export function guestTicketStateOf(id: string, d: any): GuestTicketState {
  return {
    id,
    status: String(d?.status ?? '').toLowerCase().trim(),
    checked_in: d?.checked_in === true || Boolean(d?.checked_in_at),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function serializeGuest(
  id: string,
  d: any,
  tickets?: GuestTicketState[] | null,
  ticketLink?: string | null
): GuestRecord {
  const invited = d?.invited_at
  const ticketIds: string[] = Array.isArray(d?.ticket_ids) ? d.ticket_ids.map(String) : []
  const known = (tickets || []).filter((t) => ticketIds.includes(t.id))
  const live = known.filter((t) => LIVE.has(t.status))
  const checkedInCount = live.filter((t) => t.checked_in).length
  const ticketStatus: GuestRecord['ticket_status'] =
    ticketIds.length === 0 ? 'none' : tickets && known.length > 0 && live.length === 0 ? 'cancelled' : 'issued'
  return {
    id,
    name: typeof d?.name === 'string' ? d.name : '',
    email: typeof d?.email === 'string' ? d.email : '',
    status: typeof d?.status === 'string' && d.status ? d.status : 'invited',
    plus_one: d?.plus_one === true,
    invited_at:
      invited?.toDate?.()?.toISOString?.() ??
      (typeof invited === 'string' ? invited : null),
    checked_in: d?.checked_in === true || checkedInCount > 0,
    ticket_ids: ticketIds,
    ticket_status: ticketStatus,
    checked_in_count: checkedInCount,
    email_sent: d?.email_sent === true,
    ticket_link: ticketStatus === 'issued' ? ticketLink || null : null,
  }
}

export type GuestInputResult =
  | { ok: true; value: { name?: string; email?: string; plus_one?: boolean; checked_in?: boolean } }
  | { ok: false; error: string }

/**
 * Validate a create (`partial = false`: name required, email optional since a
 * guest without one still gets a ticket link) or an edit (`partial = true`:
 * only the fields present are checked). Email is stored lower-cased so the
 * per-event duplicate check is case-blind.
 */
export function parseGuestInput(body: any, partial: boolean): GuestInputResult {
  const out: { name?: string; email?: string; plus_one?: boolean; checked_in?: boolean } = {}

  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? '').trim()
    if (!name) return { ok: false, error: 'Name is required' }
    if (name.length > 120) return { ok: false, error: 'Name is too long' }
    out.name = name
  }
  if (!partial || body?.email !== undefined) {
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!email) {
      if (partial) return { ok: false, error: 'Email is required' }
      out.email = ''
    } else {
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return { ok: false, error: 'Enter a valid email address' }
      }
      out.email = email
    }
  }
  if (body?.plus_one !== undefined) out.plus_one = body.plus_one === true
  else if (!partial) out.plus_one = false
  if (partial && body?.checked_in !== undefined) out.checked_in = body.checked_in === true

  return { ok: true, value: out }
}
