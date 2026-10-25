import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent, eventOrgId, teamSeatIn, type CurrentUser } from './context'

/**
 * Read-only finances for ONE event (earnings, tier breakdown, audit CSV):
 * the caller must be able to view the event AND see finances for the event's
 * own org: its owner, an admin of it the owner granted finance_view, or a
 * platform admin. Managers and staff never see money (lib/organizer/teamRoles
 * canViewFinances). The event's org decides, not the org picked in the
 * switcher, like canOnEvent.
 */
export async function canViewEventFinances(
  user: CurrentUser,
  event: Record<string, any> | undefined | null,
): Promise<boolean> {
  const view = await canOnEvent(user, event, 'view')
  if (!view.allowed) return false
  const orgId = eventOrgId(event)
  if (orgId && orgId === user.id) return true
  if (user.role === 'admin' || user.role === 'super_admin') return true
  if (!orgId) return false
  return Boolean((await teamSeatIn(orgId, user.id))?.financeView)
}

type Gate<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/** API gate for one event's finances: 404 / 403 responses, or the event. */
export async function requireEventFinance(
  user: CurrentUser,
  eventId: string,
): Promise<Gate<{ event: Record<string, any>; orgId: string }>> {
  if (!eventId) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  const event = snap.data() || {}
  if (!(await canViewEventFinances(user, event))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Your team role does not include finances', code: 'no_finance' }, { status: 403 }),
    }
  }
  return { ok: true, value: { event, orgId: eventOrgId(event) } }
}
