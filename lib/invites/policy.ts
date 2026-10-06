/**
 * Invites: the pure rules. No Firestore, no network, so every decision about
 * who may be invited, which code is valid and which purchase counts is unit
 * tested on its own (__tests__/invites.test.ts).
 *
 * Two features share this file:
 *   1. Event invites: a signed-in user invites ACCEPTED connections to an event.
 *      event_invites/{eventId}__{inviterUid}__{targetUid}, server-only.
 *   2. Invite links: https://www.tikem.co/i/{code}[?e={eventId}] for people who
 *      are not on Tikèm yet. invite_codes/{code} -> {uid}; a new account that
 *      arrives through one is attributed once ever (invite_attributions/{uid}).
 */

import { checkEventPurchasable } from '@/lib/tickets/purchasable'

/** Daily caps, counted on the shared Firestore limiter (lib/rate-limit.ts). */
export const INVITE_CAPS = {
  perEventPerDay: 20,
  perDay: 60,
} as const

export const DAY_MS = 24 * 60 * 60 * 1000

/** One request can carry at most this many targets (the per-event daily cap). */
export const MAX_TARGETS_PER_REQUEST = INVITE_CAPS.perEventPerDay

/** A purchase within this long of joining counts for the inviter, whatever the event. */
export const ATTRIBUTION_WINDOW_MS = 30 * DAY_MS

/** The invite cookie lives this long (seconds, for cookies().set). */
export const INVITE_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60
export const INVITE_COOKIE = 'tikem_invite'

/**
 * Only an account this young can be attributed to an invite. A link opened by
 * someone who already had an account did not bring them to Tikèm.
 */
export const NEW_ACCOUNT_WINDOW_MS = 3 * DAY_MS

export const INVITE_LINK_BASE = 'https://www.tikem.co/i/'

export type InviteSkipReason = 'already_invited' | 'already_going' | 'unavailable'

/**
 * What the picker shows for one friend. A friend who muted the inviter (or
 * blocked them) is just 'unavailable': the inviter is never told why.
 */
export type InvitePickerState = 'available' | 'invited' | 'going' | 'unavailable'

export function eventInviteDocId(eventId: string, inviterUid: string, targetUid: string): string {
  return `${eventId}__${inviterUid}__${targetUid}`
}

/** A Firestore document id we accept from a client: no slashes, bounded, not empty. */
export function isSafeId(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length > 0 &&
    raw.length <= 128 &&
    !raw.includes('/') &&
    raw !== '.' &&
    raw !== '..' &&
    !/^__.*__$/.test(raw)
  )
}

/**
 * The request's friendIds: unique, safe ids, 1..MAX_TARGETS_PER_REQUEST, never
 * the inviter. null when the body is unusable.
 */
export function normalizeFriendIds(raw: unknown, inviterUid: string): string[] | null {
  if (!Array.isArray(raw) || !raw.every(isSafeId)) return null
  const ids = Array.from(new Set(raw as string[])).filter((id) => id !== inviterUid)
  if (ids.length === 0 || ids.length > MAX_TARGETS_PER_REQUEST) return null
  return ids
}

export interface InviteFacts {
  /** The inviter's accepted connections. */
  accepted: ReadonlySet<string>
  /** Targets this inviter already invited to this event. */
  alreadyInvited: ReadonlySet<string>
  /** Targets holding a live ticket to this event. */
  holders: ReadonlySet<string>
  /** Targets who muted invites from this inviter. */
  mutedBy: ReadonlySet<string>
  /** Targets who blocked the inviter, or whom the inviter blocked. */
  blocked: ReadonlySet<string>
}

export interface InvitePlan {
  /** Not an accepted connection: the whole request is refused. */
  notConnected: string[]
  send: string[]
  skipped: Array<{ uid: string; reason: InviteSkipReason }>
}

/** Who gets an invite, who is skipped and why. Order of targets is kept. */
export function planInvites(targets: string[], facts: InviteFacts): InvitePlan {
  const plan: InvitePlan = { notConnected: [], send: [], skipped: [] }
  for (const uid of targets) {
    if (!facts.accepted.has(uid)) {
      plan.notConnected.push(uid)
      continue
    }
    const state = pickerStateFor(uid, facts)
    if (state === 'available') plan.send.push(uid)
    else if (state === 'invited') plan.skipped.push({ uid, reason: 'already_invited' })
    else if (state === 'going') plan.skipped.push({ uid, reason: 'already_going' })
    else plan.skipped.push({ uid, reason: 'unavailable' })
  }
  return plan
}

/**
 * Muted / blocked win over everything so the picker never leaks a mute through
 * a different label; going beats invited (the useful fact for the inviter).
 */
export function pickerStateFor(uid: string, facts: Omit<InviteFacts, 'accepted'>): InvitePickerState {
  if (facts.mutedBy.has(uid) || facts.blocked.has(uid)) return 'unavailable'
  if (facts.holders.has(uid)) return 'going'
  if (facts.alreadyInvited.has(uid)) return 'invited'
  return 'available'
}

/** Published, not cancelled, not ended, not held for review. */
export function isEventInvitable(event: any, now: Date = new Date()): boolean {
  if (!event) return false
  if (event.hidden_pending_review === true) return false
  return checkEventPurchasable(event, now).ok === true
}

// ── Invite codes ────────────────────────────────────────────────────────────

/** No 0/o/1/l/i: a code is read aloud and typed from a screenshot. */
export const INVITE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const INVITE_CODE_LENGTH = 8
const CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

export function isValidInviteCode(raw: unknown): raw is string {
  return typeof raw === 'string' && CODE_PATTERN.test(raw)
}

/** Lowercases and trims user input; null when it is not a code. */
export function normalizeInviteCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toLowerCase()
  return isValidInviteCode(code) ? code : null
}

/** A code from random bytes (crypto.randomBytes on the server). */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i % bytes.length] % INVITE_CODE_ALPHABET.length]
  }
  return out
}

export function inviteLinkUrl(code: string, eventId?: string | null): string {
  const base = `${INVITE_LINK_BASE}${code}`
  return eventId ? `${base}?e=${encodeURIComponent(eventId)}` : base
}

/** Where an invite link lands: the event when it names one, else sign-up. */
export function inviteLandingPath(eventId: string | null): string {
  return eventId ? `/events/${encodeURIComponent(eventId)}` : '/auth/signup'
}

/** The cookie carries `code` or `code.eventId` (an event id with a '.' is dropped). */
export function serializeInviteCookie(code: string, eventId?: string | null): string {
  return eventId && isSafeId(eventId) && !eventId.includes('.') ? `${code}.${eventId}` : code
}

export function parseInviteCookie(raw: unknown): { code: string; eventId: string | null } | null {
  if (typeof raw !== 'string' || !raw) return null
  const dot = raw.indexOf('.')
  const code = normalizeInviteCode(dot === -1 ? raw : raw.slice(0, dot))
  if (!code) return null
  const rest = dot === -1 ? '' : raw.slice(dot + 1)
  return { code, eventId: rest && isSafeId(rest) ? rest : null }
}

// ── Attribution ─────────────────────────────────────────────────────────────

export function toMs(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  const v = value as any
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  const seconds = v?.seconds ?? v?._seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

/**
 * Does a joined-through-invite record credit this purchase to the inviter?
 * Yes for the event the link was for (any time), or any event within 30 days
 * of joining.
 */
export function attributionApplies(
  attribution: { inviter_uid?: unknown; event_id?: unknown; claimed_at?: unknown } | null | undefined,
  eventId: string,
  now: number = Date.now()
): boolean {
  if (!attribution || typeof attribution.inviter_uid !== 'string' || !attribution.inviter_uid) return false
  if (attribution.event_id && attribution.event_id === eventId) return true
  const claimed = toMs(attribution.claimed_at)
  return claimed !== null && now - claimed >= 0 && now - claimed <= ATTRIBUTION_WINDOW_MS
}

export function isNewAccount(creationTime: unknown, now: number = Date.now()): boolean {
  const created = toMs(creationTime)
  return created !== null && now - created >= 0 && now - created <= NEW_ACCOUNT_WINDOW_MS
}

/** First word of a display name, for push copy. Never an email. */
export function firstName(name: unknown, fallback: string): string {
  const s = String(name ?? '').trim()
  if (!s || s.includes('@')) return fallback
  return s.split(/\s+/)[0].slice(0, 40)
}
