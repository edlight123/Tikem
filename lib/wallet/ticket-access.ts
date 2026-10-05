/**
 * The single authorization gate for wallet passes.
 *
 * A wallet pass carries a working QR code — whoever holds it can walk through
 * the gate. So the rules here are the same rules the ticket itself lives by:
 *
 *   1. the ticket must exist;
 *   2. the caller must be its CURRENT holder (`attendee_id` / `user_id` as
 *      written by every issuance path and rewritten by ticket transfer —
 *      app/api/tickets/transfer/respond/route.ts:126-128);
 *   3. the ticket must still be live. Refunded / cancelled / void / transferred
 *      away / expired tickets are refused. The check is an ALLOWLIST, so a
 *      status nobody here has heard of is refused rather than waved through.
 *
 * No id from a request body is ever trusted on its own — the caller supplies a
 * ticket id, and everything else (owner, status, event, and crucially the QR
 * payload) is read back out of Firestore.
 */

import { adminDb } from '@/lib/firebase/admin'

/** Ticket statuses that still admit someone to an event. */
const LIVE_TICKET_STATUSES = new Set(['valid', 'active', 'confirmed'])

export interface WalletTicket {
  id: string
  /** The EXISTING QR payload. Never minted here — scanners resolve this value. */
  qrPayload: string
  eventId: string
  eventTitle: string
  tierName: string
  holderName: string
  venueName: string
  city: string
  /** ISO start datetime, or null when the event has no date yet. */
  startDatetime: string | null
  endDatetime: string | null
  orderRef: string
  /** The event's poster, for the pass's blurred background. Null = plain pass. */
  bannerImageUrl: string | null
}

export type TicketAccessFailure =
  | { ok: false; code: 'ticket_not_found'; status: 404 }
  | { ok: false; code: 'not_ticket_owner'; status: 403 }
  | { ok: false; code: 'ticket_not_active'; status: 409 }

export type TicketAccessResult = { ok: true; ticket: WalletTicket } | TicketAccessFailure

/** Short human order reference, matching mobile/lib/ticket.ts:13 exactly. */
function orderRef(raw: unknown): string {
  const short = String(raw ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()
  return `TKM-${short || 'XXXXXXXX'}`
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Firestore Timestamp | Date | ISO string -> ISO string, or null. */
function toIso(value: any): string | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString()
    } catch {
      return null
    }
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * First candidate that converts to a real ISO instant.
 *
 * Not `a ?? b ?? c` — that only skips null/undefined, so an event carrying an
 * empty string or an unparseable date would win the precedence and blank the
 * pass date instead of falling back to the ticket's usable copy.
 */
function firstIso(...values: any[]): string | null {
  for (const value of values) {
    const iso = toIso(value)
    if (iso) return iso
  }
  return null
}

/**
 * Load a ticket the given user is allowed to build a pass for.
 *
 * Called BOTH when the link is minted and again when the `.pkpass` is actually
 * downloaded, so a ticket refunded in between is refused at download time.
 */
export async function loadWalletTicket(
  ticketId: string,
  userId: string
): Promise<TicketAccessResult> {
  const snapshot = await adminDb.collection('tickets').doc(String(ticketId)).get()
  if (!snapshot.exists) {
    return { ok: false, code: 'ticket_not_found', status: 404 }
  }

  const ticket = snapshot.data() as any

  // (2) Ownership. Both fields are written at issuance; transfer rewrites both.
  const ownerIds = [ticket?.attendee_id, ticket?.user_id]
    .filter((v) => typeof v === 'string' && v)
    .map((v) => String(v))
  if (!ownerIds.includes(String(userId))) {
    return { ok: false, code: 'not_ticket_owner', status: 403 }
  }

  // (3) Still live. Missing status is legacy-tolerated; anything else must be
  // explicitly on the allowlist. A refund also sets refund_status='approved',
  // which is refused independently in case status lagged behind.
  const status = String(ticket?.status ?? '').trim().toLowerCase()
  const refundStatus = String(ticket?.refund_status ?? '').trim().toLowerCase()
  const statusIsLive = status === '' || LIVE_TICKET_STATUSES.has(status)
  if (!statusIsLive || refundStatus === 'approved') {
    return { ok: false, code: 'ticket_not_active', status: 409 }
  }

  // Enrich from the event doc, but never fail the pass over it — the ticket
  // already carries denormalized copies of everything the pass shows.
  let event: any = null
  const eventId = firstString(ticket?.event_id)
  if (eventId) {
    try {
      const eventSnapshot = await adminDb.collection('events').doc(eventId).get()
      if (eventSnapshot.exists) event = eventSnapshot.data()
    } catch (error) {
      console.warn('[wallet] failed to load event for pass', {
        eventId,
        message: (error as any)?.message,
      })
    }
  }

  return {
    ok: true,
    ticket: {
      id: snapshot.id,
      // The EXISTING code, in the same precedence the app and the door use
      // (mobile/lib/ticket.ts:32; lib/scan/doorService.ts resolveTicketRef reads
      // the ticket id, then qr_code_data, then qr_code): scanners resolve this
      // value to a ticket, so minting a new one would be rejected at the gate.
      qrPayload: firstString(ticket?.qr_code_data, ticket?.qr_code, snapshot.id),
      eventId,
      eventTitle: firstString(event?.title, ticket?.event_title, 'Event'),
      tierName: firstString(ticket?.tier_name, ticket?.ticket_type, 'General Admission'),
      holderName: firstString(ticket?.attendee_name),
      venueName: firstString(ticket?.venue_name, event?.venue_name),
      city: firstString(ticket?.city, event?.city),
      // The LIVE event date wins over the copy frozen onto the ticket at
      // purchase. Organizers reschedule, and the ticket snapshot is never
      // rewritten when they do — a pass built from it sends the attendee on
      // the wrong day. The app already reads the event doc (TicketsScreen
      // hydrates start_datetime from the event), so preferring the ticket here
      // made the pass and the app disagree. Snapshot stays as the fallback for
      // tickets whose event doc is gone.
      startDatetime: firstIso(
        event?.start_datetime,
        ticket?.start_datetime,
        ticket?.event_date
      ),
      endDatetime: firstIso(event?.end_datetime, ticket?.end_datetime),
      orderRef: orderRef(ticket?.order_number || ticket?.order_id || snapshot.id),
      bannerImageUrl: firstString(event?.banner_image_url, ticket?.banner_image_url) || null,
    },
  }
}
