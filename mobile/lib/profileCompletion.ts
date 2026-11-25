/**
 * Is this account ready to enter the app? The app twin of
 * lib/auth/account/completion.ts (the root jest suite checks they agree).
 *
 * Owner rule (2026-11-25): someone who signs in with their phone enters a
 * first and last name and an email BEFORE they are let in. Verifying the email
 * can wait ("Verify later"); an address must be on file.
 *
 * No React Native imports, so the root jest suite tests it directly.
 */

export interface CompletionInput {
  fullName?: unknown
  /** Firebase Auth email (the verified sign-in identity). */
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

/**
 * Gate decision for the navigator. Only once the profile for THIS user has
 * loaded (auth `loading` flips before userProfile arrives): an unloaded or
 * offline profile never blocks the app.
 */
export function shouldGateForCompletion(params: {
  uid?: string | null
  profileId?: string | null
  fullName?: unknown
  authEmail?: unknown
  pendingEmail?: unknown
  demo?: boolean
}): boolean {
  if (params.demo || !params.uid || params.profileId !== params.uid) return false
  const c = profileCompletion(params)
  return c.needsName || c.needsEmail
}

/** Split a stored full name into the two fields, for prefill. */
export function splitName(full?: string | null): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/** "ana.joseph@gmail.com" -> "an••••@gmail.com" (for the merge copy). */
export function maskEmail(email: string): string {
  const [user, domain] = (email || '').split('@')
  if (!user || !domain) return email
  return `${user.slice(0, 2)}••••@${domain}`
}
