/**
 * Who may do what with printed tickets.
 *
 *   order / assign / void / release   the event's org: owner, admin, manager
 *                                     (requireEventAccess 'manage_events'), or
 *                                     a platform admin
 *   activate (sell)                   the same, as 'manager'; or an org
 *                                     'seller', only for the serial ranges
 *                                     assigned to them
 *
 * Org scoping is always by the EVENT's own organizer_id, never user.id
 * (lib/organizer/context canOnEvent / teamRoleIn).
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent, eventOrgId, teamRoleIn } from '@/lib/organizer/context'
import type { ActivationActor } from './rules'

export type SellerGate =
  | { ok: true; uid: string; actor: ActivationActor; event: Record<string, any>; orgId: string }
  | { ok: false; response: NextResponse }

/** Pure: the actor role for activation from what the caller is on the event's org. */
export function activationRoleFor(input: { managesEvent: boolean; orgRole: string | null }): ActivationActor['role'] | null {
  if (input.managesEvent) return 'manager'
  if (input.orgRole === 'seller') return 'seller'
  return null
}

export async function requireSellerAccess(eventId: string): Promise<SellerGate> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!eventId || eventId.includes('/')) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const event = snap.data() || {}
  const orgId = eventOrgId(event)
  const manages = await canOnEvent(user, event, 'manage_events')
  let orgRole: string | null = manages.role
  if (!manages.allowed && orgId && orgId !== user.id) orgRole = await teamRoleIn(orgId, user.id).catch(() => null)
  const role = activationRoleFor({ managesEvent: manages.allowed, orgRole })
  if (!role) {
    return { ok: false, response: NextResponse.json({ error: 'You cannot sell printed tickets for this event' }, { status: 403 }) }
  }
  return { ok: true, uid: user.id, actor: { uid: user.id, role }, event, orgId }
}
