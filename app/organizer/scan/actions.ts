'use server'

import { checkInTicket, overrideCheckIn, type CheckInResult, type CheckInParams } from '@/lib/scan/checkInTicket'
import { authorizeDoorAccess } from '@/lib/scan/doorService'

/**
 * Door-mode server actions (components/scan/DoorModeInterface).
 *
 * A server action is a public POST endpoint: anyone can call it with any
 * arguments, whatever page rendered it. These used to pass the client's params
 * straight through, so an unauthenticated caller could check in (or re-admit)
 * any ticket of any event and read back the attendee's name, and `scannedBy`
 * was whatever the client claimed.
 *
 * Now every call is authorized for the event exactly like the staff door API
 * (/api/staff/events/[id]/check-in): the event's owner, a platform admin, or a
 * member with permissions.checkin. The recorded scanner is the SESSION's uid;
 * the client's `scannedBy` is ignored.
 */
async function authorize(params: CheckInParams): Promise<CheckInParams> {
  const eventId = String(params?.eventId || '').trim()
  const ticketId = String(params?.ticketId || '').trim()
  const access = await authorizeDoorAccess(eventId)
  if (!access.ok) throw new Error(access.error || 'Not authorized')
  if (!ticketId || ticketId.includes('/')) throw new Error('Invalid ticket id')

  const entryPoint = String(params?.entryPoint || '').trim().slice(0, 80) || 'Main Entrance'
  return {
    ticketId,
    eventId,
    entryPoint,
    checkInMethod: params?.checkInMethod === 'manual' ? 'manual' : 'scan',
    scannedBy: access.uid,
  }
}

export async function performCheckIn(params: CheckInParams): Promise<CheckInResult> {
  return await checkInTicket(await authorize(params))
}

export async function performOverrideCheckIn(params: CheckInParams): Promise<CheckInResult> {
  return await overrideCheckIn(await authorize(params))
}
