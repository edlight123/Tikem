/**
 * Is this account ready to enter the app? (The web twin of
 * mobile/lib/profileCompletion.ts; keep the two in step.)
 *
 * Owner rule (2026-11-25): a person who signs in with their phone enters
 * their first and last name and an email BEFORE they are let in. Verifying
 * the email can wait ("Verify later"), but an address must be on file.
 *
 *   needsName   no full name on the profile (any account: never show a
 *               nameless account)
 *   needsEmail  no email on the sign-in account AND none saved to verify later
 *               (only phone-only accounts can be here: every other sign-in
 *               method comes with an email)
 *   emailUnverified  an address was saved for later but not verified yet
 *               (the quiet reminder strip)
 *
 * Pure, no imports: safe in server, client and the root jest suite.
 */

export interface CompletionInput {
  fullName?: unknown
  /** Firebase Auth email (verified sign-in identity). */
  authEmail?: unknown
  /** users/{uid}.pending_email: typed, not verified yet. */
  pendingEmail?: unknown
}

export interface Completion {
  needsName: boolean
  needsEmail: boolean
  emailUnverified: boolean
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

export function profileCompletion(i: CompletionInput): Completion {
  const hasAuthEmail = filled(i.authEmail)
  return {
    needsName: !filled(i.fullName),
    needsEmail: !hasAuthEmail && !filled(i.pendingEmail),
    emailUnverified: !hasAuthEmail && filled(i.pendingEmail),
  }
}

/** First + last name, trimmed and collapsed; null when either is missing or too long. */
export function composeFullName(first: unknown, last: unknown): { first: string; last: string; full: string } | null {
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
  const f = clean(first)
  const l = clean(last)
  if (!f || !l || f.length > 50 || l.length > 50) return null
  // No markup or control characters in a display name.
  if (/[<>\u0000-\u001f]/.test(f + l)) return null
  return { first: f, last: l, full: `${f} ${l}` }
}

/** A plausible email, lower-cased; null otherwise. Real proof is the code. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  if (e.length < 6 || e.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null
}
