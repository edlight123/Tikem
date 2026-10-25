/**
 * The attendee notification switches, as stored on users/{uid}.
 *
 * Pure: no Firestore. Every reader of these switches (the send policy, the
 * notification triggers, the web profile card) goes through here so the field
 * the card WRITES is the field the senders READ.
 *
 * Why this exists: the web profile card used to save a nested
 * `notify: { reminders, updates, promos }` object that no sender looked at,
 * while the senders read top-level `notify_reminders` / `notify_event_updates`
 * / `notify_discovery` ... (lib/notifications/policy.ts). The mobile app has
 * always written the top-level fields.
 *
 * Backward compatibility: a user who switched reminders or updates off on the
 * old card has `notify.reminders === false` / `notify.updates === false` and no
 * top-level field. That was a real choice, so it is honoured when the top-level
 * field is absent. The old `notify.promos` is NOT mapped onto anything: every
 * account created by the old profile code was seeded with `promos: false`, so
 * it says nothing about what the person wanted.
 */

export const USER_NOTIFY_FIELDS = [
  'notify_reminders',
  'notify_event_updates',
  'notify_discovery',
  'notify_filling_fast',
  'notify_national_day',
] as const

export type UserNotifyField = (typeof USER_NOTIFY_FIELDS)[number]
export type UserNotifyPrefs = Record<UserNotifyField, boolean>

/** Top-level field → key in the legacy nested `notify` object. */
const LEGACY_NESTED: Partial<Record<string, 'reminders' | 'updates'>> = {
  notify_reminders: 'reminders',
  notify_event_updates: 'updates',
}

/**
 * Is this switch on? Top-level field first, then the legacy nested value,
 * then on (an absent field means opted in, as policy.ts has always assumed).
 */
export function readUserNotifyPref(
  data: Record<string, any> | null | undefined,
  field: string
): boolean {
  const top = data?.[field]
  if (typeof top === 'boolean') return top
  const legacyKey = LEGACY_NESTED[field]
  if (legacyKey) {
    const nested = data?.notify?.[legacyKey]
    if (typeof nested === 'boolean') return nested
  }
  return true
}

export function readUserNotifyPrefs(data: Record<string, any> | null | undefined): UserNotifyPrefs {
  const out = {} as UserNotifyPrefs
  for (const f of USER_NOTIFY_FIELDS) out[f] = readUserNotifyPref(data, f)
  return out
}

/** Keep only known switches with boolean values: safe to merge onto users/{uid}. */
export function sanitizeUserNotifyPrefs(input: unknown): Partial<UserNotifyPrefs> {
  const out: Partial<UserNotifyPrefs> = {}
  if (!input || typeof input !== 'object') return out
  for (const f of USER_NOTIFY_FIELDS) {
    const v = (input as Record<string, unknown>)[f]
    if (typeof v === 'boolean') out[f] = v
  }
  return out
}
