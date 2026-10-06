/**
 * GET /i/{code}[?e={eventId}]  a personal invite link.
 *
 * A route handler rather than a page: it only sets the 30-day attribution
 * cookie and redirects, and cookies can only be written from a handler. The
 * cookie is claimed when the visitor signs up (app/api/auth/session and
 * /api/invites/claim, lib/invites/server.ts#claimInvite).
 *
 * Redirects to the event when `e` is given, else to sign-up. An unknown code,
 * or config/auth.invites off, still redirects (a shared link never dead-ends);
 * it just sets no cookie.
 */
import { NextResponse } from 'next/server'
import { isSocialFlagOn } from '@/lib/social/flags'
import {
  INVITE_COOKIE,
  INVITE_COOKIE_MAX_AGE_S,
  inviteLandingPath,
  isSafeId,
  normalizeInviteCode,
  serializeInviteCookie,
} from '@/lib/invites/policy'
import { resolveInviteCode } from '@/lib/invites/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ code: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const url = new URL(request.url)
  const rawEvent = url.searchParams.get('e')
  const eventId = rawEvent && isSafeId(rawEvent) ? rawEvent : null
  // Relative to the request host: tikem.co 308s to www, and a cross-host
  // redirect here would drop the cookie we are about to set.
  const res = NextResponse.redirect(new URL(inviteLandingPath(eventId), url.origin), 307)
  res.headers.set('Cache-Control', 'private, no-store')

  const code = normalizeInviteCode((await params).code)
  if (!code) return res
  try {
    if (!(await isSocialFlagOn('invites'))) return res
    if (!(await resolveInviteCode(code))) return res
  } catch {
    return res
  }
  res.cookies.set(INVITE_COOKIE, serializeInviteCookie(code, eventId), {
    maxAge: INVITE_COOKIE_MAX_AGE_S,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
  return res
}
