import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canViewFinances, isTeamRole, orgCan, type OrgAction, type OrgRole, type TeamRole } from './teamRoles'

/**
 * "Which organization am I acting for, and as what?" The one answer every
 * organizer page and API uses instead of `user.id`.
 *
 * Data model (all server-written; clients may only read their own):
 *   organizers/{orgId}/team/{uid}        { uid, email, name, role, status: 'active', ... }
 *   users/{uid}/org_memberships/{orgId}  { org_id, role, org_name }   (mirror, for "my orgs")
 *   org_team_invites/{inviteId}          { org_id, email, role, token_hash, expires_at, ... }
 *
 * The org a request acts for comes from the X-Tikem-Org header (mobile) or the
 * tikem_org cookie (web switcher), and only counts when the caller is an
 * active member of it. Otherwise the caller acts for their own org (owner),
 * and an account that is not itself an organizer falls through to its first
 * membership, so a team member who opens /organizer lands in the org they
 * belong to.
 */

export const ORG_COOKIE = 'tikem_org'
export const ORG_INVITES = 'org_team_invites'
export const ORG_HEADER = 'x-tikem-org'

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export interface OrgContext {
  user: CurrentUser
  /** The organization's id: the owner's uid, and what events carry as organizer_id. */
  orgId: string
  role: OrgRole
  isOwner: boolean
  /** Platform admin (Tikèm staff): may act on any org's events. */
  isPlatformAdmin: boolean
  /** May see this org's finances read-only (owner, or an admin granted finance_view). */
  financeView: boolean
}

export interface OrgMembership {
  orgId: string
  role: TeamRole
  orgName: string
}

export function teamCol(orgId: string) {
  return adminDb.collection('organizers').doc(orgId).collection('team')
}

export function membershipsCol(uid: string) {
  return adminDb.collection('users').doc(uid).collection('org_memberships')
}

function isPlatformAdmin(user: CurrentUser): boolean {
  return user.role === 'admin' || user.role === 'super_admin'
}

function isOrganizerAccount(user: CurrentUser): boolean {
  return user.role === 'organizer' || isPlatformAdmin(user)
}

async function requestedOrgId(): Promise<string | null> {
  try {
    const h = await headers()
    const fromHeader = (h.get(ORG_HEADER) || '').trim()
    if (fromHeader) return fromHeader
  } catch {
    // headers() outside a request (scripts/tests)
  }
  try {
    const c = await cookies()
    const fromCookie = (c.get(ORG_COOKIE)?.value || '').trim()
    if (fromCookie) return fromCookie
  } catch {
    // ignore
  }
  return null
}

/** The caller's active seat in `orgId` (role + read-only finance grant), or null. */
export async function teamSeatIn(orgId: string, uid: string): Promise<{ role: TeamRole; financeView: boolean } | null> {
  if (!orgId || !uid || orgId === uid) return null
  const snap = await teamCol(orgId).doc(uid).get()
  if (!snap.exists) return null
  const d = snap.data() || {}
  if (d.status !== 'active' || !isTeamRole(d.role)) return null
  return { role: d.role, financeView: canViewFinances(d.role, d.finance_view === true) }
}

/** The caller's active role in `orgId`, or null. Reads organizers/{orgId}/team/{uid}. */
export async function teamRoleIn(orgId: string, uid: string): Promise<TeamRole | null> {
  return (await teamSeatIn(orgId, uid))?.role ?? null
}

export async function listMemberships(uid: string): Promise<OrgMembership[]> {
  const snap = await membershipsCol(uid).get()
  const out: OrgMembership[] = []
  for (const doc of snap.docs) {
    const d = doc.data() || {}
    if (isTeamRole(d.role)) out.push({ orgId: doc.id, role: d.role, orgName: String(d.org_name || '') })
  }
  // The org's CURRENT name: the copy on the mirror is only a fallback, so a
  // rename by the owner or an admin shows up in every member's switcher.
  await Promise.all(
    out.map(async (m) => {
      const live = await orgDisplayName(m.orgId)
      if (live) m.orgName = live
    }),
  )
  return out.sort((a, b) => a.orgName.localeCompare(b.orgName))
}

/** Resolve the acting organization for this request. Null: not signed in, or no org at all. */
export async function getOrgContext(): Promise<OrgContext | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const admin = isPlatformAdmin(user)

  const requested = await requestedOrgId()
  if (requested && requested !== user.id) {
    const seat = await teamSeatIn(requested, user.id)
    if (seat) return { user, orgId: requested, role: seat.role, isOwner: false, isPlatformAdmin: admin, financeView: seat.financeView }
  }

  if (isOrganizerAccount(user)) {
    return { user, orgId: user.id, role: 'owner', isOwner: true, isPlatformAdmin: admin, financeView: true }
  }

  // Not an organizer themselves: their first org, if they belong to one.
  const memberships = await listMemberships(user.id)
  for (const m of memberships) {
    const seat = await teamSeatIn(m.orgId, user.id)
    if (seat) return { user, orgId: m.orgId, role: seat.role, isOwner: false, isPlatformAdmin: admin, financeView: seat.financeView }
  }
  return null
}

type Gate<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/** API gate: the acting org, if the caller's role there may perform `action`. */
export async function requireOrg(action: OrgAction): Promise<Gate<OrgContext>> {
  const ctx = await getOrgContext()
  if (!ctx) {
    const user = await getCurrentUser()
    return {
      ok: false,
      response: NextResponse.json(
        { error: user ? 'Organizer access required' : 'Unauthorized' },
        { status: user ? 403 : 401 },
      ),
    }
  }
  if (!orgCan(ctx.role, action)) {
    return { ok: false, response: NextResponse.json({ error: 'Your team role does not allow this' }, { status: 403 }) }
  }
  return { ok: true, value: ctx }
}

/**
 * API gate for READ-ONLY finance routes (earnings, payout history, revenue
 * reports, exports): the owner, or an admin with the finance grant. Scope the
 * data by ctx.orgId, never user.id. Writes and bank details stay owner-only.
 */
export async function requireFinanceView(): Promise<Gate<OrgContext>> {
  const ctx = await getOrgContext()
  if (!ctx) {
    const user = await getCurrentUser()
    return {
      ok: false,
      response: NextResponse.json({ error: user ? 'Organizer access required' : 'Unauthorized' }, { status: user ? 403 : 401 }),
    }
  }
  if (!ctx.financeView) {
    return { ok: false, response: NextResponse.json({ error: 'Your team role does not include finances', code: 'no_finance' }, { status: 403 }) }
  }
  return { ok: true, value: ctx }
}

export function eventOrgId(event: Record<string, any> | undefined | null): string {
  return String(event?.organizer_id || event?.organizerId || '')
}

/**
 * May the caller do `action` on this event? True for the event's org when the
 * caller's role there allows it, and for platform admins. Checks the event's
 * own org, not just the acting one, so a member of several orgs is not bounced
 * for having the "wrong" org selected.
 */
export async function canOnEvent(
  user: CurrentUser,
  event: Record<string, any> | undefined | null,
  action: OrgAction,
): Promise<{ allowed: boolean; role: OrgRole | null }> {
  const orgId = eventOrgId(event)
  if (!orgId) return { allowed: isPlatformAdmin(user), role: null }
  if (orgId === user.id) return { allowed: orgCan('owner', action), role: 'owner' }
  const role = await teamRoleIn(orgId, user.id)
  if (role && orgCan(role, action)) return { allowed: true, role }
  return { allowed: isPlatformAdmin(user), role }
}

export interface EventAccess {
  user: CurrentUser
  event: Record<string, any>
  eventId: string
  /** The event's organization (its organizer_id). */
  orgId: string
  role: OrgRole | null
}

/** API gate for one event: 401/404/403 responses, or the event and the caller's standing. */
export async function requireEventAccess(eventId: string, action: OrgAction): Promise<Gate<EventAccess>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!eventId) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const event = snap.data() || {}
  const { allowed, role } = await canOnEvent(user, event, action)
  if (!allowed) return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true, value: { user, event, eventId, orgId: eventOrgId(event), role } }
}

/** Display name for an org (its organizer profile), for memberships and emails. */
export async function orgDisplayName(orgId: string): Promise<string> {
  try {
    const [org, user] = await Promise.all([
      adminDb.collection('organizers').doc(orgId).get(),
      adminDb.collection('users').doc(orgId).get(),
    ])
    const o = org.data() || {}
    const u = user.data() || {}
    return String(
      o.organization_name || o.org_name || o.name || u.organization_name || u.business_name || u.full_name || '',
    ).trim()
  } catch {
    return ''
  }
}

/** Make `uid` an active `role` member of `orgId` (team doc + membership mirror). */
export async function activateMember(params: {
  orgId: string
  uid: string
  email: string
  name?: string | null
  role: TeamRole
  addedBy: string
  /** Read-only finances; only meaningful for admins. Omitted = keep what is stored. */
  financeView?: boolean
}): Promise<void> {
  const { orgId, uid, email, role, addedBy } = params
  const finance =
    role !== 'admin' ? { finance_view: false } : params.financeView === undefined ? {} : { finance_view: params.financeView === true }
  const orgName = await orgDisplayName(orgId)
  const batch = adminDb.batch()
  batch.set(
    teamCol(orgId).doc(uid),
    {
      uid,
      email: email.toLowerCase(),
      name: params.name || null,
      role,
      ...finance,
      status: 'active',
      added_by: addedBy,
      joined_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  batch.set(membershipsCol(uid).doc(orgId), { org_id: orgId, role, org_name: orgName, updated_at: FieldValue.serverTimestamp() })
  await batch.commit()
}

/** Remove `uid` from `orgId` (team doc + mirror). */
export async function deactivateMember(orgId: string, uid: string): Promise<void> {
  const batch = adminDb.batch()
  batch.delete(teamCol(orgId).doc(uid))
  batch.delete(membershipsCol(uid).doc(orgId))
  // Retire the invites that seated them, so no old link can bring them back.
  const accepted = await adminDb.collection(ORG_INVITES).where('org_id', '==', orgId).where('accepted_by', '==', uid).get()
  for (const doc of accepted.docs) batch.set(doc.ref, { revoked_at: FieldValue.serverTimestamp() }, { merge: true })
  await batch.commit()
}

/**
 * Accept every open invite addressed to this account's VERIFIED email (Google
 * and Apple sign-ins are verified). Unverified accounts must use the emailed
 * accept link instead: otherwise anyone could register an invitee's address
 * and take their seat.
 */
export async function claimInvitesByVerifiedEmail(user: CurrentUser): Promise<number> {
  const email = String(user.email || '').toLowerCase()
  if (!email || !(user as any).email_verified) return 0
  const snap = await adminDb.collection(ORG_INVITES).where('email', '==', email).get()
  let claimed = 0
  for (const doc of snap.docs) {
    const d = doc.data() || {}
    if (d.accepted_at || d.revoked_at) continue
    if (d.expires_at?.toDate && d.expires_at.toDate() < new Date()) continue
    if (!isTeamRole(d.role) || !d.org_id || d.org_id === user.id) continue
    await activateMember({ orgId: d.org_id, uid: user.id, email, name: d.name, role: d.role, addedBy: d.invited_by || d.org_id, financeView: d.finance_view === true })
    await doc.ref.set({ accepted_at: FieldValue.serverTimestamp(), accepted_by: user.id }, { merge: true })
    claimed++
  }
  return claimed
}
