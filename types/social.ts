/**
 * Shared types for the social layer:
 * - Public social handles (Instagram, TikTok, etc.) — display only.
 * - Privacy controls (default private).
 * - Friend connections (native requests + contact matching).
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'twitter' | 'facebook'

/**
 * Social media handles a user chooses to display on their profile.
 * Stored as raw handles (without the leading @). Display-only — we never
 * verify ownership, so the UI labels these as user-provided links.
 */
export interface SocialLinks {
  instagram?: string
  tiktok?: string
  twitter?: string
  facebook?: string
}

/**
 * Who can see the events a user is attending.
 * - 'nobody'   → fully private (DEFAULT)
 * - 'friends'  → only accepted friends can see "I'm going"
 * - 'everyone' → shown in the public "Who's going" face pile
 */
export type AttendanceVisibility = 'nobody' | 'friends' | 'everyone'

/**
 * Who can view the user's social profile (bio + social handles).
 * - 'private' → only the user (and friends) (DEFAULT)
 * - 'public'  → anyone can view
 */
export type ProfileVisibility = 'private' | 'public'

export interface PrivacySettings {
  /** Visibility of the user's social profile page. Default 'private'. */
  profile_visibility: ProfileVisibility
  /** Who can see which events the user is attending. Default 'nobody'. */
  attendance_visibility: AttendanceVisibility
  /**
   * Whether the user can be found by someone who already has their phone
   * number saved in contacts (mutual-knowledge model, like WhatsApp/Signal).
   * Default true so the "find friends from contacts" flow works.
   */
  discoverable_by_phone: boolean
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  profile_visibility: 'private',
  attendance_visibility: 'nobody',
  discoverable_by_phone: true,
}

/** Friend request / friendship status. */
export type ConnectionStatus = 'pending' | 'accepted'

/**
 * A connection (friendship) between two users. One document per pair.
 * `users` is sorted so the document id is deterministic and duplicate
 * requests are impossible.
 */
export interface Connection {
  id: string
  users: [string, string]
  requester_id: string
  recipient_id: string
  status: ConnectionStatus
  created_at: string
  updated_at: string
  accepted_at?: string | null
}

/** The relationship of the current viewer to another user. */
export type FriendshipState =
  | 'none' // no relationship
  | 'friends' // accepted
  | 'request_sent' // current user sent a pending request
  | 'request_received' // current user received a pending request
  | 'self' // same user

/** A lightweight public view of a user, safe to expose to other users. */
export interface PublicUserSummary {
  uid: string
  displayName: string
  photoURL?: string
  isVerified?: boolean
}

/** Why a person is suggested. Never says WHICH events or friends. */
export type SuggestionReason = 'mutual_friends' | 'same_events'

/** GET /api/connections/suggestions item: public fields + a reason. */
export interface FriendSuggestion extends PublicUserSummary {
  username?: string
  reason: SuggestionReason
  mutualCount: number
}

/** GET /api/events/[id]/friends-going: only the viewer's own connections. */
export interface FriendsGoingResponse {
  enabled: boolean
  count: number
  friends: PublicUserSummary[]
}

/**
 * Build a deterministic connection document id for a pair of user ids.
 * Sorting guarantees both directions resolve to the same id.
 */
export function connectionIdFor(a: string, b: string): string {
  return [a, b].sort().join('__')
}

/**
 * A contact-book number reduced to full E.164, or '' when it cannot be read
 * unambiguously. Contact discovery matches on this exactly: a last-8-digits
 * match let a caller sweep every number sharing a suffix across countries.
 *
 * - "+…" or "00…" is taken as international.
 * - 8 national digits are Haitian (+509), the app's home market.
 * - 10 digits, or 11 starting with 1, are NANP (+1), the diaspora.
 * Anything else is rejected rather than guessed.
 */
export function phoneToE164(raw: string | null | undefined): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const digits = s.replace(/\D+/g, '')
  if (!digits) return ''
  let e164 = ''
  if (s.startsWith('+')) e164 = `+${digits}`
  else if (digits.startsWith('00')) e164 = `+${digits.slice(2)}`
  else if (digits.length === 8) e164 = `+509${digits}`
  else if (digits.length === 10) e164 = `+1${digits}`
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`
  else return ''
  // E.164: at most 15 digits, country code never starts with 0.
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : ''
}

/**
 * Normalize a phone number to a stable match key.
 * Digits only, last 8. LEGACY: no longer used for contact discovery (see
 * phoneToE164); still written to `phone_normalized` on profile updates.
 */
export function phoneMatchKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = String(raw).replace(/\D+/g, '')
  if (!digits) return ''
  return digits.length > 8 ? digits.slice(-8) : digits
}

const HANDLE_CLEAN = /[^a-zA-Z0-9._]/g

/**
 * Normalize a user-entered social value (handle or full URL) into a bare
 * handle we can store. Returns '' if nothing usable is found.
 */
export function normalizeSocialHandle(platform: SocialPlatform, raw: string | null | undefined): string {
  if (!raw) return ''
  let value = String(raw).trim()
  if (!value) return ''

  // If a full URL was pasted, extract the last meaningful path segment.
  if (/^https?:\/\//i.test(value) || value.includes('/')) {
    try {
      const url = value.startsWith('http') ? new URL(value) : new URL(`https://${value}`)
      const segments = url.pathname.split('/').filter(Boolean)
      value = segments.length ? segments[segments.length - 1] : value
    } catch {
      const segments = value.split('/').filter(Boolean)
      value = segments.length ? segments[segments.length - 1] : value
    }
  }

  // Strip a leading @ and any stray characters.
  value = value.replace(/^@+/, '').replace(HANDLE_CLEAN, '')
  return value.slice(0, 50)
}

/** Build the public-facing URL for a social handle. */
export function socialUrlFor(platform: SocialPlatform, handle: string): string {
  const h = handle.replace(/^@+/, '')
  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${h}`
    case 'tiktok':
      return `https://tiktok.com/@${h}`
    case 'twitter':
      return `https://twitter.com/${h}`
    case 'facebook':
      return `https://facebook.com/${h}`
    default:
      return ''
  }
}

/** Sanitize an incoming SocialLinks object from a request body. */
export function sanitizeSocialLinks(input: unknown): SocialLinks {
  const out: SocialLinks = {}
  if (!input || typeof input !== 'object') return out
  const obj = input as Record<string, unknown>
  ;(['instagram', 'tiktok', 'twitter', 'facebook'] as SocialPlatform[]).forEach((p) => {
    const handle = normalizeSocialHandle(p, typeof obj[p] === 'string' ? (obj[p] as string) : '')
    if (handle) out[p] = handle
  })
  return out
}

/** Sanitize an incoming privacy object, falling back to safe defaults. */
export function sanitizePrivacy(input: unknown, current?: Partial<PrivacySettings>): PrivacySettings {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const profileVis = obj.profile_visibility ?? current?.profile_visibility
  const attendanceVis = obj.attendance_visibility ?? current?.attendance_visibility
  const discoverable = obj.discoverable_by_phone ?? current?.discoverable_by_phone

  return {
    profile_visibility: profileVis === 'public' ? 'public' : 'private',
    attendance_visibility:
      attendanceVis === 'everyone' || attendanceVis === 'friends' ? attendanceVis : 'nobody',
    discoverable_by_phone: discoverable === false ? false : true,
  }
}
