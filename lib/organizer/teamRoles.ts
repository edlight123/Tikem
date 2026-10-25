/**
 * Organization team roles and what each may do. One table, used by every
 * organizer page and API on the web and mirrored in mobile/lib/orgTeamRoles.ts
 * and firestore.rules (isOrgTeam). Owner feedback 2026-10-25: the Team page
 * listed "Admin: full access" while membership granted nothing at all.
 *
 *   owner    the account the org belongs to (organizers/{orgId} === its uid)
 *   admin    everything except money out, bank/payout details, identity
 *            verification and deleting the org; manages the team (not the owner)
 *   manager  runs events: create, edit, publish, tickets, orders, guests,
 *            check-in, messages, promo codes, analytics
 *   staff    nothing org-wide; door access comes per event (Staff tab)
 */

export type OrgRole = 'owner' | 'admin' | 'manager' | 'staff'
export type TeamRole = Exclude<OrgRole, 'owner'>

export const TEAM_ROLES: TeamRole[] = ['admin', 'manager', 'staff']

export type OrgAction =
  /** See the organizer dashboard, events, orders, guests, analytics. */
  | 'view'
  /** Create, edit, publish and run events (tiers, comps, promo, staff, messages, refunds). */
  | 'manage_events'
  /** Invite, re-role and remove team members (never the owner). */
  | 'manage_team'
  /** Organization profile, branding, notification settings. */
  | 'manage_settings'
  /** Payouts, withdrawals, bank/MonCash details, verification, deleting the org. */
  | 'owner_only'

const ALLOWED: Record<OrgAction, OrgRole[]> = {
  view: ['owner', 'admin', 'manager'],
  manage_events: ['owner', 'admin', 'manager'],
  manage_team: ['owner', 'admin'],
  manage_settings: ['owner', 'admin'],
  owner_only: ['owner'],
}

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as string[]).includes(value)
}

export function orgCan(role: OrgRole | null | undefined, action: OrgAction): boolean {
  return !!role && ALLOWED[action].includes(role)
}

/**
 * Read-only finances (earnings, payout history, revenue reports, exports) for a
 * team member: only an ADMIN the owner explicitly granted it to (team doc
 * finance_view). Never withdrawals, never bank/MonCash/Stripe details: whoever
 * can change where money goes can take it, so that stays owner-only.
 */
export function canViewFinances(role: OrgRole | null | undefined, financeView: boolean | undefined): boolean {
  return role === 'owner' || (role === 'admin' && financeView === true)
}
