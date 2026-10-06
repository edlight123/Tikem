/**
 * Claim the invite carried by the web `tikem_invite` cookie for a user who has
 * just signed in. Returns true when the cookie was dealt with (claimed, or not
 * claimable) and may be cleared; false when the invites switch is off, so the
 * cookie survives until it is back on or expires.
 */
import { isSocialFlagOn } from '@/lib/social/flags'
import { parseInviteCookie } from './policy'
import { claimInvite } from './server'

export async function claimFromInviteCookie(uid: string, raw: string): Promise<boolean> {
  if (!(await isSocialFlagOn('invites'))) return false
  const parsed = parseInviteCookie(raw)
  if (!parsed) return true
  await claimInvite({ uid, code: parsed.code, eventId: parsed.eventId })
  return true
}
