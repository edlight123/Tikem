/**
 * The acting organization, the dependency-free half (docs/specs/org-teams.md).
 *
 * Holds the one value the API client needs synchronously (which org to send
 * as X-Tikem-Org) and the pure rule that picks the active org from the
 * GET /api/organizer/orgs answer. No React, Firebase or Expo imports: the
 * backend client imports this, and root Jest tests can import it too. The
 * store with hooks, storage and fetching is lib/activeOrg.ts.
 */
import { isTeamRole, type OrgRole, type TeamRole } from './orgTeamRoles';

/** Header the server reads to pick the acting org (lib/organizer/context.ts). */
export const ORG_HEADER = 'X-Tikem-Org';

let headerOrgId: string | null = null;

/** The org to send as X-Tikem-Org: set only while acting for someone else's org. */
export function actingOrgHeader(): string | null {
  return headerOrgId;
}

export function setActingOrgHeader(orgId: string | null): void {
  headerOrgId = orgId || null;
}

export interface OrgOption {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

/** The GET /api/organizer/orgs body. */
export interface OrgsResponse {
  own?: { orgId: string; orgName?: string; role?: string } | null;
  memberships?: Array<{ orgId: string; role: string; orgName?: string }>;
  active?: { orgId: string; role: string } | null;
}

/**
 * The orgs this account can run in organizer mode: its own (when it is an
 * organizer) and every team where it is admin or manager. Staff memberships
 * are left out: staff get door access per event, in the staff tools.
 */
export function orgOptionsFrom(res: OrgsResponse | null | undefined): OrgOption[] {
  const out: OrgOption[] = [];
  if (res?.own?.orgId) {
    out.push({ orgId: String(res.own.orgId), orgName: String(res.own.orgName || ''), role: 'owner' });
  }
  for (const m of res?.memberships || []) {
    if (!m?.orgId || !isTeamRole(m.role) || m.role === 'staff') continue;
    if (out.some((o) => o.orgId === m.orgId)) continue;
    out.push({ orgId: String(m.orgId), orgName: String(m.orgName || ''), role: m.role as TeamRole });
  }
  return out;
}

/**
 * Which option is active: the stored choice if it is still on offer, else the
 * server's pick, else the account's own org, else the first team. Null when
 * there is nothing (the caller then treats the account as its own org).
 */
export function pickActiveOrg(
  options: OrgOption[],
  storedOrgId: string | null | undefined,
  serverActiveOrgId?: string | null,
): OrgOption | null {
  const find = (id?: string | null) => (id ? options.find((o) => o.orgId === id) || null : null);
  return (
    find(storedOrgId) ||
    find(serverActiveOrgId) ||
    options.find((o) => o.role === 'owner') ||
    options[0] ||
    null
  );
}
