import 'server-only'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent, getOrgContext, type CurrentUser, type OrgContext } from '@/lib/organizer/context'
import { orgCan, type OrgAction, type OrgRole } from '@/lib/organizer/teamRoles'

/**
 * Page-side gates for /organizer (server components and server actions).
 * The API routes use requireOrg / requireEventAccess from lib/organizer/context;
 * these are the same rules, answered with redirect()/notFound() instead of JSON.
 *
 * Roles: lib/organizer/teamRoles.ts (docs/specs/org-teams.md).
 */

function isOrganizerAccount(user: CurrentUser): boolean {
  return user.role === 'organizer' || user.role === 'admin' || user.role === 'super_admin'
}

/**
 * The org this request acts for, as far as the organizer PORTAL is concerned:
 * an org where the caller may at least `view`. A staff-only membership grants
 * nothing org-wide, so when the switcher cookie points at one, an organizer
 * falls back to their own org (and a non-organizer gets null, i.e. today's
 * upgrade prompt). Cached per request so layout + page share one lookup.
 */
export const getPortalOrgContext = cache(async (): Promise<OrgContext | null> => {
  const ctx = await getOrgContext()
  if (!ctx) return null
  if (orgCan(ctx.role, 'view')) return ctx
  if (isOrganizerAccount(ctx.user)) {
    return {
      user: ctx.user,
      orgId: ctx.user.id,
      role: 'owner',
      isOwner: true,
      isPlatformAdmin: ctx.user.role === 'admin' || ctx.user.role === 'super_admin',
    }
  }
  return null
})

/** Signed-in user or a redirect to sign-in that comes back to `path`. */
export async function requireSignedIn(path: string): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect(`/auth/login?redirect=${encodeURIComponent(path)}`)
  return user as CurrentUser
}

/**
 * Org-level page gate. No account: sign in. No org at all: /organizer (which
 * shows the upgrade prompt). Role too low for `action`: /organizer (the
 * dashboard every member with an org can see).
 */
export async function requireOrgPage(action: OrgAction, path: string): Promise<OrgContext> {
  await requireSignedIn(path)
  const ctx = await getPortalOrgContext()
  if (!ctx) redirect(`/organizer?redirect=${encodeURIComponent(path)}`)
  if (!orgCan(ctx.role, action)) redirect('/organizer')
  return ctx
}

export interface EventPageAccess {
  user: CurrentUser
  event: Record<string, any>
  eventId: string
  /** The event's org (its organizer_id). */
  orgId: string
  role: OrgRole | null
}

/**
 * Per-event page gate: the event's own org decides (canOnEvent), not the org
 * picked in the switcher. Missing event or no standing on it: 404, as before.
 * A member who may view but not do `action`: back to the event overview.
 */
export async function requireEventPage(eventId: string, action: OrgAction, path?: string): Promise<EventPageAccess> {
  const user = await requireSignedIn(path || `/organizer/events/${eventId}`)
  if (!eventId) notFound()
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) notFound()
  const event = snap.data() || {}
  const { allowed, role } = await canOnEvent(user, event, action)
  if (!allowed) {
    if (action !== 'view') {
      const view = await canOnEvent(user, event, 'view')
      if (view.allowed) redirect(`/organizer/events/${eventId}`)
    }
    notFound()
  }
  return { user, event, eventId, orgId: String(event.organizer_id || event.organizerId || ''), role }
}

/**
 * Owner-only areas (payouts, withdrawals, payout settings, verification,
 * danger zone) that still read the signed-in account's own records: a team
 * member acting for someone else's org is sent to /organizer instead.
 */
export async function redirectNonOwners(): Promise<void> {
  const ctx = await getPortalOrgContext()
  if (ctx && !ctx.isOwner) redirect('/organizer')
}
