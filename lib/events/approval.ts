/**
 * Request-to-attend approval lists and plus-ones: the PURE rules.
 *
 * Spec: docs/specs/approval-lists-and-plus-ones.md. No Firestore here, so the
 * web composer, the event page and the API routes can all import it. The app
 * mirrors it in mobile/lib/attendRequests.ts (a parity test keeps them equal).
 */

import { MAX_FREE_TICKETS_PER_PERSON, hasPaidTier, type TierPriceLike } from '@/lib/ticketPricing'

/** The most plus-ones an organizer can offer, before the free-ticket cap. */
export const PLUS_ONES_SETTING_MAX = 3

/** A note to the host, in characters. */
export const ATTEND_NOTE_MAX = 280

/** A plus-one's first name, in characters. */
export const PLUS_ONE_NAME_MAX = 60

export const ATTEND_REQUESTS_COLLECTION = 'attend_requests'

export type AttendRequestStatus = 'pending' | 'approving' | 'approved' | 'declined' | 'cancelled'

export interface PlusOne {
  first_name: string
  phone: string | null
}

/** One request per person per event: a double tap cannot make two. */
export function attendRequestId(eventId: string, uid: string): string {
  return `${eventId}__${uid}`
}

/** The organizer's own setting, sanitised to an integer 0..PLUS_ONES_SETTING_MAX. */
export function plusOnesSetting(event: { plus_ones_max?: unknown } | null | undefined): number {
  const n = Math.floor(Number(event?.plus_ones_max ?? 0))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, PLUS_ONES_SETTING_MAX)
}

/**
 * How many plus-ones a guest may actually name.
 *
 * Plus-one tickets are issued to the requester through the free-claim path, so
 * requester + plus-ones must fit inside the per-person free cap. With the cap at
 * 2, an organizer's "3" still means 1.
 */
export function allowedPlusOnes(setting: unknown, cap: number = MAX_FREE_TICKETS_PER_PERSON): number {
  const s = plusOnesSetting({ plus_ones_max: setting })
  const room = Math.max(0, Math.floor(Number(cap) || 0) - 1)
  return Math.max(0, Math.min(s, room, PLUS_ONES_SETTING_MAX))
}

/** The plus-ones a guest may name on this event. */
export function eventAllowedPlusOnes(event: { plus_ones_max?: unknown } | null | undefined): number {
  return allowedPlusOnes(event?.plus_ones_max)
}

/** Does the event ask guests to request a spot? */
export function eventRequiresApproval(event: { requires_approval?: unknown } | null | undefined): boolean {
  return event?.requires_approval === true
}

/**
 * Approval is for FREE events only in v1. Paid when the event says so
 * (`has_paid_tiers`, its authoritative flag) or any tier costs money.
 */
export function approvalBlockedByPrice(
  event: { has_paid_tiers?: unknown } | null | undefined,
  tiers: TierPriceLike[] | null | undefined
): boolean {
  return event?.has_paid_tiers === true || hasPaidTier(tiers || [])
}

export type AttendInputResult =
  | { ok: true; plusOnes: PlusOne[]; note: string }
  | { ok: false; error: string; code: 'too_many_plus_ones' | 'plus_one_name_required' | 'note_too_long' | 'invalid_plus_ones' }

/**
 * Validate what a guest sends with a request (or a named claim).
 * `phoneNormalizer` turns a typed phone into E.164; injected so this stays pure.
 */
export function parseAttendInput(
  raw: { plusOnes?: unknown; note?: unknown },
  allowed: number,
  phoneNormalizer: (raw: string) => string = (p) => p.trim()
): AttendInputResult {
  const list = raw?.plusOnes ?? []
  if (!Array.isArray(list)) {
    return { ok: false, error: 'Plus-ones must be a list.', code: 'invalid_plus_ones' }
  }
  if (list.length > allowed) {
    return {
      ok: false,
      error: allowed === 0 ? 'This event does not allow plus-ones.' : `You can bring at most ${allowed} plus-one${allowed === 1 ? '' : 's'}.`,
      code: 'too_many_plus_ones',
    }
  }
  const plusOnes: PlusOne[] = []
  for (const entry of list) {
    const firstName = String((entry as any)?.firstName ?? (entry as any)?.first_name ?? '').trim()
    if (!firstName) {
      return { ok: false, error: 'Each plus-one needs a first name.', code: 'plus_one_name_required' }
    }
    const phoneRaw = String((entry as any)?.phone ?? '').trim()
    plusOnes.push({
      first_name: firstName.slice(0, PLUS_ONE_NAME_MAX),
      phone: phoneRaw ? phoneNormalizer(phoneRaw) || null : null,
    })
  }
  const note = String(raw?.note ?? '').trim()
  if (note.length > ATTEND_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${ATTEND_NOTE_MAX} characters.`, code: 'note_too_long' }
  }
  return { ok: true, plusOnes, note }
}

/** Organizer list order: pending first, then approved, declined, cancelled; oldest first inside pending. */
const STATUS_ORDER: Record<string, number> = { pending: 0, approving: 0, approved: 1, declined: 2, cancelled: 3 }

export function sortAttendRequests<T extends { status?: string | null; created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const s = (STATUS_ORDER[a.status || ''] ?? 9) - (STATUS_ORDER[b.status || ''] ?? 9)
    if (s !== 0) return s
    const ta = Date.parse(a.created_at || '') || 0
    const tb = Date.parse(b.created_at || '') || 0
    // Pending: oldest first (first come, first served). Decided: newest first.
    return (STATUS_ORDER[a.status || ''] ?? 9) === 0 ? ta - tb : tb - ta
  })
}

/**
 * Paid rails (card, MonCash, SogePay) can carry free lines in a mixed cart. On
 * an approval-list event those free tickets must come through the list, so the
 * cart is refused. Null when the order may proceed.
 */
export function approvalFreeLinesRefusal(
  event: { requires_approval?: unknown } | null | undefined,
  freeQuantity: number
): { status: 403; error: string; code: 'approval_required' } | null {
  if (!eventRequiresApproval(event) || !(freeQuantity > 0)) return null
  return {
    status: 403,
    error: 'Free tickets for this event are given by the host. Send a request instead.',
    code: 'approval_required',
  }
}
