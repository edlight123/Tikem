/**
 * WHO on an organization hears about something (SERVER-SIDE ONLY).
 *
 * Organizer-facing notifications used to go to the event's `organizer_id`
 * alone: the org owner. Org teams (docs/specs/org-teams.md) put admins,
 * managers and door staff on an org, and owner feedback 2026-11-15 asked that
 * they get those notifications too, "depending on their admin level". This is
 * the one place that decides it; every organizer-facing sender asks here
 * instead of notifying `organizer_id` directly.
 *
 * Kinds and who receives them (the default policy; change ROLE_KINDS to adjust):
 *
 *   event_ops   sales, free claims/RSVPs, attend requests, refund requests,
 *               attendee messages, sell-through milestones, slow-sales nudges
 *               → owner, admin, manager
 *   event_day   door / event-day operations for ONE event
 *               → owner, admin, manager, and staff ASSIGNED to that event
 *                 (a doc in events/{id}/members). Nothing sends this yet.
 *   finance     payouts, withdrawals, payout failures, payout reviews,
 *               disputes, Stripe/payout account blocked
 *               → owner, and admins the owner granted finance_view
 *   team        team membership changes → owner, admin. Nothing sends this yet.
 *   owner_only  identity/payout verification outcomes → owner
 *
 * Always: the owner is included (unless they are the actor), active seats only
 * (organizers/{orgId}/team/{uid} with status 'active'; removed members have no
 * doc, pending invitees have only an org_team_invites row), the actor is never
 * notified about their own action, and ids are deduped.
 *
 * Preferences and caps stay PER RECIPIENT: callers send to each id with the
 * same path they used for the owner (sendDiscretionary keys its cap by user).
 * Org-level switches (organizers/{orgId}/notificationPreferences/main) are
 * org settings and apply to every recipient of that org.
 */
import { adminDb } from '@/lib/firebase/admin'
import { canViewFinances, isTeamRole, type TeamRole } from '@/lib/organizer/teamRoles'

export type OrgNotificationKind = 'event_ops' | 'event_day' | 'finance' | 'team' | 'owner_only'

export interface OrgSeat {
  uid: string
  role: TeamRole
  /** Read-only finance grant (only ever true for admins). */
  financeView: boolean
}

/** Which team roles receive each kind. Staff is further limited to assigned events. */
const ROLE_KINDS: Record<TeamRole, ReadonlySet<OrgNotificationKind>> = {
  admin: new Set<OrgNotificationKind>(['event_ops', 'event_day', 'finance', 'team']),
  manager: new Set<OrgNotificationKind>(['event_ops', 'event_day']),
  staff: new Set<OrgNotificationKind>(['event_day']),
}

/** Does one seat receive this kind? Pure. */
export function seatReceives(
  seat: OrgSeat,
  kind: OrgNotificationKind,
  opts: { assignedToEvent?: boolean } = {}
): boolean {
  if (!ROLE_KINDS[seat.role]?.has(kind)) return false
  if (kind === 'finance') return canViewFinances(seat.role, seat.financeView)
  if (seat.role === 'staff') return opts.assignedToEvent === true
  return true
}

/**
 * The recipients, from already-loaded data. Pure: the policy lives here so it
 * can be tested without Firestore. Owner first, then seats in the given order.
 */
export function pickOrgRecipients(params: {
  ownerId: string
  seats: OrgSeat[]
  kind: OrgNotificationKind
  /** uids with a member doc on the event (door staff assignments). */
  eventStaffIds?: Iterable<string>
  /** The actor(s): never notified about their own action. */
  excludeUserIds?: Iterable<string | null | undefined>
}): string[] {
  const { ownerId, seats, kind } = params
  const exclude = new Set<string>()
  for (const id of params.excludeUserIds || []) if (id) exclude.add(String(id))
  const assigned = new Set<string>()
  for (const id of params.eventStaffIds || []) if (id) assigned.add(String(id))

  const out: string[] = []
  const seen = new Set<string>()
  const add = (uid: string) => {
    if (!uid || seen.has(uid) || exclude.has(uid)) return
    seen.add(uid)
    out.push(uid)
  }

  add(ownerId)
  if (kind === 'owner_only') return out
  for (const seat of seats) {
    if (!seat?.uid || seat.uid === ownerId) continue
    if (seatReceives(seat, kind, { assignedToEvent: assigned.has(seat.uid) })) add(seat.uid)
  }
  return out
}

/** Active team seats of an org. Throws on a Firestore failure (the caller falls back). */
export async function loadOrgSeats(orgId: string): Promise<OrgSeat[]> {
  const snap = await adminDb.collection('organizers').doc(orgId).collection('team').where('status', '==', 'active').get()
  const seats: OrgSeat[] = []
  for (const doc of snap.docs as any[]) {
    const d = doc.data() || {}
    if (d.status !== 'active' || !isTeamRole(d.role)) continue
    const uid = String(d.uid || doc.id)
    if (!uid || uid === orgId) continue
    seats.push({ uid, role: d.role, financeView: d.role === 'admin' && d.finance_view === true })
  }
  return seats
}

/** Which of `uids` hold a door-staff assignment (events/{eventId}/members/{uid}). */
async function loadAssignedStaff(eventId: string, uids: string[]): Promise<string[]> {
  if (!eventId || uids.length === 0) return []
  const eventRef = adminDb.collection('events').doc(eventId)
  const snaps = await adminDb.getAll(...uids.map((uid) => eventRef.collection('members').doc(uid)))
  return (snaps as any[]).filter((s) => s?.exists).map((s) => String(s.id))
}

/**
 * Who in `orgId` to notify about `kind` (for `eventId`, when the thing is about
 * one event). Never throws: if the team cannot be read, the owner alone (minus
 * the actor), which is exactly what every sender did before teams.
 */
export async function resolveOrgRecipients(params: {
  orgId: string | null | undefined
  kind: OrgNotificationKind
  eventId?: string | null
  excludeUserIds?: Array<string | null | undefined>
}): Promise<string[]> {
  const ownerId = String(params.orgId || '').trim()
  if (!ownerId) return []
  const { kind, excludeUserIds } = params
  if (kind === 'owner_only') return pickOrgRecipients({ ownerId, seats: [], kind, excludeUserIds })

  let seats: OrgSeat[] = []
  try {
    seats = await loadOrgSeats(ownerId)
  } catch (error) {
    console.error('[orgRecipients] team unreadable; owner only', { orgId: ownerId, error: (error as any)?.message })
    return pickOrgRecipients({ ownerId, seats: [], kind, excludeUserIds })
  }

  let eventStaffIds: string[] = []
  const staffSeats = seats.filter((s) => s.role === 'staff')
  if (kind === 'event_day' && params.eventId && staffSeats.length > 0) {
    try {
      eventStaffIds = await loadAssignedStaff(String(params.eventId), staffSeats.map((s) => s.uid))
    } catch (error) {
      console.error('[orgRecipients] event staff unreadable', { eventId: params.eventId, error: (error as any)?.message })
    }
  }

  return pickOrgRecipients({ ownerId, seats, kind, eventStaffIds, excludeUserIds })
}
