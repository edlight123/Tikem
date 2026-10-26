import { adminDb } from '@/lib/firebase/admin'
import { ORG_INVITES, membershipsCol, orgDisplayName, teamCol } from './context'

/** The org team roster: active members (current profile names) and open invites. */

export const INVITE_PREFIX = 'invite:'

export type RosterRow = {
  id: string
  uid: string | null
  email: string
  name: string | null
  role: string
  status: 'active' | 'invited'
  joined_at: string | null
  /** Admin granted read-only finances by the owner. */
  finance_view: boolean
}

export function iso(v: any): string | null {
  return v?.toDate?.()?.toISOString?.() ?? (typeof v === 'string' ? v : null)
}

export async function roster(orgId: string): Promise<RosterRow[]> {
  const [team, invites] = await Promise.all([
    teamCol(orgId).get(),
    adminDb.collection(ORG_INVITES).where('org_id', '==', orgId).get(),
  ])
  const rows: RosterRow[] = []
  for (const d of team.docs) {
    const x = d.data() || {}
    // Legacy rows from before invites existed (random ids, status 'invited')
    // never granted anything; show them as invites so they can be re-sent or removed.
    rows.push({
      id: d.id,
      uid: x.uid || null,
      email: String(x.email || ''),
      name: x.name || null,
      role: String(x.role || 'staff'),
      status: x.status === 'active' && x.uid === d.id ? 'active' : 'invited',
      joined_at: iso(x.joined_at),
      finance_view: x.role === 'admin' && x.finance_view === true,
    })
  }
  const now = Date.now()
  for (const d of invites.docs) {
    const x = d.data() || {}
    if (x.accepted_at || x.revoked_at) continue
    if (x.expires_at?.toDate && x.expires_at.toDate().getTime() < now) continue
    rows.push({
      id: `${INVITE_PREFIX}${d.id}`,
      uid: null,
      email: String(x.email || ''),
      name: x.name || null,
      role: String(x.role || 'staff'),
      status: 'invited',
      joined_at: iso(x.created_at),
      finance_view: x.role === 'admin' && x.finance_view === true,
    })
  }
  // Self-repair: members seated before the switcher existed (or by any path
  // that missed it) have no users/{uid}/org_memberships/{org} mirror, so the
  // org never appears in their "Acting for" switcher. Restore it here, every
  // time the roster is read, so owners never have to know.
  await Promise.all(
    rows
      .filter((r) => r.status === 'active' && r.uid)
      .map(async (r) => {
        try {
          const ref = membershipsCol(r.uid!).doc(orgId)
          if (!(await ref.get()).exists) {
            await ref.set({ org_id: orgId, role: r.role, org_name: await orgDisplayName(orgId) })
          }
        } catch {
          // best effort
        }
      }),
  )

  // Active members show their CURRENT profile name, not the one typed at invite.
  await Promise.all(
    rows
      .filter((r) => r.status === 'active' && r.uid)
      .map(async (r) => {
        try {
          const u = (await adminDb.collection('users').doc(r.uid!).get()).data() || {}
          const live = String(u.full_name || u.display_name || '').trim()
          if (live) r.name = live
        } catch {
          // keep the stored name
        }
      }),
  )
  return rows.sort((a, b) => String(b.joined_at || '').localeCompare(String(a.joined_at || '')))
}
