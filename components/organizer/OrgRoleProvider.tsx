'use client'

import { createContext, useContext } from 'react'
import { orgCan, type OrgAction, type OrgRole } from '@/lib/organizer/teamRoles'

/**
 * The acting org and the signed-in member's role in it, resolved once on the
 * server by app/organizer/layout.tsx (getOrgContext) and handed to every
 * client component under /organizer. Navigation and buttons read it to hide
 * what the role cannot do; the server still enforces every rule.
 */
export interface OrgRoleValue {
  orgId: string
  orgName: string
  role: OrgRole
  isOwner: boolean
}

const OrgRoleContext = createContext<OrgRoleValue | null>(null)

export function OrgRoleProvider({ value, children }: { value: OrgRoleValue | null; children: React.ReactNode }) {
  return <OrgRoleContext.Provider value={value}>{children}</OrgRoleContext.Provider>
}

/** Null outside the organizer portal, or for an account with no org. */
export function useOrgRole(): OrgRoleValue | null {
  return useContext(OrgRoleContext)
}

/** May the acting role do `action`? False with no org. */
export function useOrgCan(action: OrgAction): boolean {
  const ctx = useContext(OrgRoleContext)
  return orgCan(ctx?.role, action)
}
