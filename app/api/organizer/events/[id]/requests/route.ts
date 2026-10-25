// The organizer's approval list for one event
// (docs/specs/approval-lists-and-plus-ones.md). The event's org team (owner,
// admin, manager) or a platform admin; every read
// and write goes through the Admin SDK (attend_requests has no client rules).

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import {
  approveAllPending,
  approveRequest,
  canManageEvent,
  declineRequest,
  listEventRequests,
} from '@/lib/attend-requests/server'
import { canOnEvent } from '@/lib/organizer/context'
import type { OrgAction } from '@/lib/organizer/teamRoles'
import { eventAllowedPlusOnes, eventRequiresApproval } from '@/lib/events/approval'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function json(body: any, status = 200) {
  return NextResponse.json(body, { status })
}

/** The event, when the caller may manage its list; otherwise the response to send. */
async function authorize(eventId: string, action: OrgAction) {
  const user = await getCurrentUser()
  if (!user) return { response: json({ error: 'Not authenticated', code: 'auth_required' }, 401) }
  const snap = await adminDb.collection('events').doc(eventId).get()
  if (!snap.exists) return { response: json({ error: 'Event not found', code: 'event_not_found' }, 404) }
  const event = { id: snap.id, ...snap.data() } as any
  if (!canManageEvent(user, event) && !(await canOnEvent(user, event, action)).allowed) {
    return { response: json({ error: 'You do not own this event', code: 'not_event_owner' }, 403) }
  }
  return { user, event }
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const auth = await authorize(String(id), 'view')
    if ('response' in auth) return auth.response
    const { requests, counts } = await listEventRequests(String(id))
    return json({
      requests,
      counts,
      requiresApproval: eventRequiresApproval(auth.event),
      allowedPlusOnes: eventAllowedPlusOnes(auth.event),
    })
  } catch (error: any) {
    console.error('[organizer/requests] GET failed', error?.message)
    return json({ error: 'Could not load requests.', code: 'server_error' }, 500)
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const eventId = String(id)
    const auth = await authorize(eventId, 'manage_events')
    if ('response' in auth) return auth.response
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '')

    if (action === 'approve_all') {
      return json(await approveAllPending(eventId, auth.event, auth.user.id))
    }

    const requestId = String(body?.requestId || '')
    // A request id names its event; one for another event is not this list's.
    if (!requestId || !requestId.startsWith(`${eventId}__`)) {
      return json({ error: 'Request not found', code: 'request_not_found' }, 404)
    }
    if (action === 'approve') {
      const result = await approveRequest(eventId, auth.event, requestId, auth.user.id)
      return result.ok ? json(result) : json({ error: result.error, code: result.code }, result.status)
    }
    if (action === 'decline') {
      const result = await declineRequest(eventId, auth.event, requestId, auth.user.id)
      return result.ok ? json(result) : json({ error: result.error, code: result.code }, result.status)
    }
    return json({ error: 'Unknown action', code: 'invalid_action' }, 400)
  } catch (error: any) {
    console.error('[organizer/requests] POST failed', error?.message)
    return json({ error: 'Could not update the request.', code: 'server_error' }, 500)
  }
}
