/**
 * Door team service: the pure rules. No Firebase import, so every decision is
 * unit-tested directly.
 *
 * DATA MODEL: door_team_requests/{requestId} (server-only, Admin SDK)
 * ------------------------------------------------------------------
 *   event_id, organizer_id, event_title, event_start_at, event_end_at
 *   staff_count, arrival_at (ISO), hours, notes, contact_name, contact_phone
 *   standard_quote     the config quote when requested (DoorTeamQuoteBreakdown)
 *   price_htg          what the organizer pays (set when quoted)
 *   price_kind         'standard' | 'negotiated'
 *   quote_note, quoted_at, quoted_by, quote_expires_at
 *   status             see DoorTeamStatus below
 *   payment            { method, funds_rail, status, order_id, stripe_session_id,
 *                        amount_usd_cents, fx_*, reference, amount, currency,
 *                        paid_at, refunded_to_balance_at }
 *   payment_expires_at the 2h window of the CURRENT payment attempt
 *   crew               [{ uid, first_name, assigned_at, assigned_by }]
 *   crew_uids          for the per-crew lookups
 *   access_from / access_until   the door-access window granted to the crew
 *   refund             { due, rail, amount, currency, status: 'pending' |
 *                        'refunded' | 'credited' | 'none', reference }
 *   needs_refund, late_payments  a payment that landed after the request was
 *                      closed, or a second payment: flagged for the admin
 *   history            [{ at, by, action, ... }] (also admin_audit_log)
 *
 * Related: door_team_orders/{orderId} (MonCash order → request), the crew's
 * events/{eventId}/members/{uid} door seat (source 'tikem_door_team'),
 * withdrawal_requests/doorteam_{requestId} (balance payment), and
 * config/door_team (+ history).
 */

import type { DoorTeamConfig } from './config'

export const DOOR_TEAM_REQUESTS = 'door_team_requests'
export const DOOR_TEAM_ORDERS = 'door_team_orders'
export const DOOR_TEAM_MEMBER_SOURCE = 'tikem_door_team'
export const doorTeamOffsetId = (requestId: string) => `doorteam_${requestId}`

/** An unpaid payment attempt is abandoned after this (card sessions live 31 minutes). */
export const PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000
/** A quote stays open this long, and never later than QUOTE_CLOSES_BEFORE_MS before the event. */
export const QUOTE_TTL_MS = 5 * 24 * 60 * 60 * 1000
export const QUOTE_CLOSES_BEFORE_MS = 24 * 60 * 60 * 1000
/** The crew may open the door list this long before arrival (offline sync)... */
export const ACCESS_LEAD_MS = 24 * 60 * 60 * 1000
/** ...and keeps door access this long after the shift (or the event) ends. */
export const ACCESS_TAIL_MS = 6 * 60 * 60 * 1000
/** Arrival may be at most this long before the event starts. */
export const MAX_ARRIVAL_BEFORE_START_MS = 12 * 60 * 60 * 1000

export type DoorTeamStatus =
  | 'requested' // organizer asked; waiting for Tikèm
  | 'quoted' // Tikèm set the price; waiting for the organizer to pay
  | 'paid' // paid; crew being assigned
  | 'confirmed' // crew assigned and granted door access
  | 'done' // after the event; crew access removed
  | 'declined' // Tikèm cannot staff it (reason given)
  | 'cancelled' // organizer cancelled
  | 'expired' // quote never paid in time

export type DoorTeamFundsRail = 'moncash' | 'stripe_platform' | 'balance_offset'
export type DoorTeamPayMethod = 'moncash' | 'card' | 'balance'

const MOVES: Record<DoorTeamStatus, DoorTeamStatus[]> = {
  requested: ['quoted', 'declined', 'cancelled'],
  quoted: ['paid', 'declined', 'cancelled', 'expired'],
  paid: ['confirmed', 'cancelled'],
  confirmed: ['done', 'cancelled'],
  done: [],
  declined: [],
  cancelled: [],
  expired: [],
}

export function canMoveRequest(from: DoorTeamStatus, to: DoorTeamStatus): boolean {
  return (MOVES[from] || []).includes(to)
}

export const isOpenStatus = (s: string) => s === 'requested' || s === 'quoted' || s === 'paid' || s === 'confirmed'
export const isPaidStatus = (s: string) => s === 'paid' || s === 'confirmed' || s === 'done'

/** A Date from an ISO string, a Firestore Timestamp, a Date or millis; null otherwise. */
export function toDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null
  const v: any = raw
  const d =
    typeof v?.toDate === 'function'
      ? v.toDate()
      : v instanceof Date
        ? v
        : typeof v === 'object' && typeof v._seconds === 'number'
          ? new Date(v._seconds * 1000)
          : typeof v === 'object' && typeof v.seconds === 'number'
            ? new Date(v.seconds * 1000)
            : new Date(v)
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
}

export interface RequestInput {
  staffCount: number
  arrivalAt: string
  hours: number
  notes?: string | null
  contactName: string
  contactPhone: string
}

export type RequestValidation =
  | {
      ok: true
      value: { staff_count: number; arrival_at: string; hours: number; notes: string; contact_name: string; contact_phone: string }
    }
  | { ok: false; code: string; field?: string }

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)

/**
 * An organizer's request: staff within the configured crew size, whole hours
 * within the longest shift, the event at least `minLeadHours` away, arrival
 * between 12h before the start and the event end, and an on-site contact.
 */
export function validateRequestInput(
  raw: Partial<RequestInput> | null | undefined,
  ctx: { config: DoorTeamConfig; now: number; eventStart: Date | null; eventEnd: Date | null }
): RequestValidation {
  const { config, now, eventStart, eventEnd } = ctx
  if (!config.enabled) return { ok: false, code: 'disabled' }
  const staff = Number(raw?.staffCount)
  if (!Number.isInteger(staff) || staff <= 0) return { ok: false, code: 'invalid_staff', field: 'staffCount' }
  if (staff < config.minStaff) return { ok: false, code: 'below_min_staff', field: 'staffCount' }
  if (staff > config.maxStaff) return { ok: false, code: 'above_max_staff', field: 'staffCount' }
  const hours = Number(raw?.hours)
  if (!Number.isInteger(hours) || hours <= 0) return { ok: false, code: 'invalid_hours', field: 'hours' }
  if (hours > config.maxHours) return { ok: false, code: 'above_max_hours', field: 'hours' }

  if (!eventStart) return { ok: false, code: 'event_has_no_date' }
  if (eventStart.getTime() - now < config.minLeadHours * 3600_000) return { ok: false, code: 'too_late' }

  const arrival = toDate(raw?.arrivalAt)
  if (!arrival) return { ok: false, code: 'invalid_arrival', field: 'arrivalAt' }
  if (arrival.getTime() < eventStart.getTime() - MAX_ARRIVAL_BEFORE_START_MS) return { ok: false, code: 'arrival_too_early', field: 'arrivalAt' }
  const latest = eventEnd && eventEnd.getTime() > eventStart.getTime() ? eventEnd.getTime() : eventStart.getTime() + 12 * 3600_000
  if (arrival.getTime() > latest) return { ok: false, code: 'arrival_after_event', field: 'arrivalAt' }
  if (arrival.getTime() < now) return { ok: false, code: 'invalid_arrival', field: 'arrivalAt' }

  const contactName = clean(raw?.contactName, 80)
  if (contactName.length < 2) return { ok: false, code: 'contact_name_required', field: 'contactName' }
  const contactPhone = clean(raw?.contactPhone, 32)
  if (contactPhone.replace(/\D/g, '').length < 7 || !/^[+\d][\d\s().-]*$/.test(contactPhone)) {
    return { ok: false, code: 'contact_phone_invalid', field: 'contactPhone' }
  }
  return {
    ok: true,
    value: {
      staff_count: staff,
      arrival_at: arrival.toISOString(),
      hours,
      notes: clean(raw?.notes, 1000),
      contact_name: contactName,
      contact_phone: contactPhone,
    },
  }
}

/**
 * The admin's price: the standard quote, or a negotiated whole-HTG price with
 * a note (the note is what the organizer sees as the reason, and it is audited).
 */
export function validateQuotePrice(
  input: { priceHtg?: unknown; note?: unknown },
  standardHtg: number,
  maxHtg = 10_000_000
): { ok: true; priceHtg: number; kind: 'standard' | 'negotiated'; note: string } | { ok: false; code: string } {
  const note = clean(input?.note, 500)
  if (input?.priceHtg === undefined || input?.priceHtg === null || input?.priceHtg === '') {
    if (!(standardHtg > 0)) return { ok: false, code: 'no_standard_price' }
    return { ok: true, priceHtg: standardHtg, kind: 'standard', note }
  }
  const price = Number(input.priceHtg)
  if (!Number.isInteger(price) || price <= 0 || price > maxHtg) return { ok: false, code: 'invalid_price' }
  if (price === standardHtg) return { ok: true, priceHtg: price, kind: 'standard', note }
  if (note.length < 3) return { ok: false, code: 'note_required' }
  return { ok: true, priceHtg: price, kind: 'negotiated', note }
}

/** When an unpaid quote closes: QUOTE_TTL_MS after quoting, but no later than 24h before the event. */
export function quoteExpiresAt(quotedAt: number, eventStart: Date | null): string {
  const ttl = quotedAt + QUOTE_TTL_MS
  const cap = eventStart ? eventStart.getTime() - QUOTE_CLOSES_BEFORE_MS : ttl
  return new Date(Math.max(quotedAt + 60 * 60 * 1000, Math.min(ttl, cap))).toISOString()
}

/** The window the crew may scan in: a day before arrival to 6h after the shift / event ends. */
export function crewAccessWindow(req: { arrival_at: string; hours: number; event_end_at?: string | null }): { from: Date; until: Date } {
  const arrival = toDate(req.arrival_at)!.getTime()
  const shiftEnd = arrival + Number(req.hours || 0) * 3600_000
  const eventEnd = toDate(req.event_end_at)?.getTime() || 0
  return { from: new Date(arrival - ACCESS_LEAD_MS), until: new Date(Math.max(shiftEnd, eventEnd) + ACCESS_TAIL_MS) }
}

/** Pure: is a door seat with this window live at `now`? (No window = a normal staff seat.) */
export function withinAccessWindow(member: { access_from?: unknown; access_until?: unknown } | null | undefined, now: number): boolean {
  if (!member) return false
  const from = toDate(member.access_from)
  const until = toDate(member.access_until)
  if (from && now < from.getTime()) return false
  if (until && now > until.getTime()) return false
  return true
}

export type CancelDecision =
  | { ok: true; refund: 'none' | 'credit_balance' | 'refund_original'; reason: 'unpaid' | 'in_time' | 'too_late' }
  | { ok: false; code: string }

/**
 * Organizer cancellation:
 *   - not paid yet (requested / quoted): free, nothing to refund;
 *   - paid, at least refundCutoffHours before the event: refunded. Paid from
 *     the balance → credited straight back; MonCash / card → flagged for the
 *     admin to refund to the original method;
 *   - paid, later than that: cancelled, no refund.
 */
export function cancelDecision(
  req: { status: string; payment?: { funds_rail?: string } | null; event_start_at?: string | null },
  ctx: { now: number; refundCutoffHours: number }
): CancelDecision {
  if (req.status === 'requested' || req.status === 'quoted') return { ok: true, refund: 'none', reason: 'unpaid' }
  if (req.status !== 'paid' && req.status !== 'confirmed') return { ok: false, code: 'not_cancellable' }
  const start = toDate(req.event_start_at)
  const inTime = !!start && start.getTime() - ctx.now >= ctx.refundCutoffHours * 3600_000
  if (!inTime) return { ok: true, refund: 'none', reason: 'too_late' }
  return { ok: true, refund: req.payment?.funds_rail === 'balance_offset' ? 'credit_balance' : 'refund_original', reason: 'in_time' }
}

/** A display first name only: what the organizer sees about Tikèm's crew. */
export function firstNameOf(full: unknown): string {
  const s = String(full ?? '').trim()
  if (!s || s.includes('@')) return ''
  return s.split(/\s+/)[0].slice(0, 40)
}

/** Pure: may this payment method be offered? Balance only when one event's released HTG covers it all. */
export function showBalanceFor(balance: { canUse?: boolean; availableHtg?: number } | null | undefined, priceHtg: number): boolean {
  if (!balance?.canUse) return false
  return Number.isFinite(priceHtg) && priceHtg > 0 && Number(balance.availableHtg) >= priceHtg
}

/**
 * What the organizer's screens get: no crew uids, no admin ids, no gateway
 * references beyond the method; crew as first names only.
 */
export function organizerView(r: Record<string, any>) {
  return {
    id: String(r.id || ''),
    status: String(r.status || ''),
    staff_count: Number(r.staff_count) || 0,
    arrival_at: r.arrival_at || null,
    hours: Number(r.hours) || 0,
    notes: String(r.notes || ''),
    contact_name: String(r.contact_name || ''),
    contact_phone: String(r.contact_phone || ''),
    standard_quote: r.standard_quote || null,
    price_htg: r.price_htg ?? null,
    price_kind: r.price_kind || null,
    quote_note: r.quote_note || '',
    quote_expires_at: r.quote_expires_at || null,
    decline_reason: r.decline_reason || '',
    payment: r.payment
      ? {
          method: r.payment.method || null,
          funds_rail: r.payment.funds_rail || null,
          status: r.payment.status || null,
          paid_at: r.payment.paid_at || null,
          refunded_to_balance_at: r.payment.refunded_to_balance_at || null,
        }
      : null,
    payment_expires_at: r.payment_expires_at || null,
    crew: Array.isArray(r.crew) ? r.crew.map((c: any) => ({ first_name: String(c?.first_name || '') })) : [],
    refund: r.refund ? { due: !!r.refund.due, status: r.refund.status || null, rail: r.refund.rail || null } : null,
    cancel_reason: r.cancel_reason || null,
    created_at: r.created_at || null,
  }
}
