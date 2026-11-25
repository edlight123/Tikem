import { NextRequest, NextResponse, after } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin/audit-log'
import {
  assignCrew,
  completeRequest,
  confirmRequest,
  declineRequest,
  findCrewAccount,
  getRequest,
  markRefunded,
  quoteRequest,
  removeCrew,
  type Moved,
} from '@/lib/doorTeam/requests'
import { notifyConfirmed, notifyDeclined, notifyQuoted } from '@/lib/doorTeam/notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/door-team/requests/:requestId   (platform admins only)
 *
 * { action: 'quote', priceHtg?, note? }   accept at the standard price, or set a
 *                                         negotiated one (note required) → quoted
 * { action: 'decline', reason }           → declined (the organizer sees the reason)
 * { action: 'assign_crew', email }        put a Tikèm crew account on the event's
 *                                         door (door check-in only, time-boxed)
 * { action: 'remove_crew', uid }
 * { action: 'confirm' }                   crew assigned → confirmed
 * { action: 'done' }                      after the event; crew access removed
 * { action: 'mark_refunded', reference }  a flagged refund was made by hand
 *
 * Every action is written to admin_audit_log (and the request's own history).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const { requestId } = await params
  const current = await getRequest(String(requestId || ''))
  if (!current) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const body: any = await request.json().catch(() => ({}))
  const action = String(body?.action || '')
  const admin = { uid: user.id }
  let result: Moved
  let details: Record<string, any> = {}
  try {
    switch (action) {
      case 'quote':
        result = await quoteRequest(current.id, admin, { priceHtg: body?.priceHtg, note: body?.note })
        if (result.ok) {
          details = { price_htg: result.request.price_htg, price_kind: result.request.price_kind, note: result.request.quote_note, standard_htg: result.request.standard_htg_at_quote }
          const r = result.request
          after(() => notifyQuoted(r))
        }
        break
      case 'decline':
        result = await declineRequest(current.id, admin, body?.reason)
        if (result.ok) {
          details = { reason: result.request.decline_reason }
          const r = result.request
          after(() => notifyDeclined(r))
        }
        break
      case 'assign_crew': {
        const crew = await findCrewAccount(String(body?.email || ''))
        if (!crew) return NextResponse.json({ error: 'No Tikèm account with that email', code: 'crew_not_found' }, { status: 404 })
        result = await assignCrew(current.id, crew, admin)
        details = { crew_uid: crew.uid }
        break
      }
      case 'remove_crew':
        result = await removeCrew(current.id, String(body?.uid || ''), admin)
        details = { crew_uid: String(body?.uid || '') }
        break
      case 'confirm':
        result = await confirmRequest(current.id, admin)
        if (!result.ok && result.code === 'no_crew') {
          return NextResponse.json({ error: 'Assign at least one crew member first', code: 'no_crew' }, { status: 409 })
        }
        if (result.ok) {
          const r = result.request
          after(() => notifyConfirmed(r))
        }
        break
      case 'done':
        result = await completeRequest(current.id, user.id)
        break
      case 'mark_refunded':
        result = await markRefunded(current.id, admin, body?.reference)
        details = { reference: String(body?.reference || '') }
        break
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[admin/door-team] action failed', { requestId, action, message: err?.message })
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  await logAdminAction({
    action: `door_team.request.${action}`,
    adminId: user.id,
    adminEmail: user.email || '',
    resourceId: current.id,
    resourceType: 'door_team_request',
    details: { event_id: current.event_id, from: current.status, to: result.request.status, ...details },
  })
  return NextResponse.json({ ok: true, status: result.request.status })
}
