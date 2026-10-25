import crypto from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { teamRoleIn } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'

export type InviteMethod = 'email' | 'phone' | 'link'

export type EventInvitePermissions = {
  checkin: true
  viewAttendees: boolean
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

export function randomToken(bytes: number = 32): string {
  return crypto
    .randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function inviteUrlFor(eventId: string, token: string): string {
  return `https://tikem.co/invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`
}

export function inviteDeepLinkFor(eventId: string, token: string): string {
  return `tikem://invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`
}

/**
 * May `uid` manage this event's door staff? The event's organizer, a member
 * with role 'owner', or an admin/manager of the event's organization team
 * (manage_events, lib/organizer/teamRoles.ts). Throws otherwise.
 */
export async function assertEventOwner(params: { eventId: string; uid: string }): Promise<void> {
  const { eventId, uid } = params

  const eventRef = adminDb.collection('events').doc(eventId)
  const memberRef = eventRef.collection('members').doc(uid)

  const [eventSnap, memberSnap] = await Promise.all([eventRef.get(), memberRef.get()])

  if (!eventSnap.exists) {
    throw new Error('Event not found')
  }

  const event = eventSnap.data() as any
  const organizerId = String(event?.organizer_id || event?.organizerId || '')

  const memberRole = memberSnap.exists ? String((memberSnap.data() as any)?.role || '') : ''

  if (organizerId === uid || memberRole === 'owner') return
  const orgRole = organizerId ? await teamRoleIn(organizerId, uid) : null
  if (!orgCan(orgRole, 'manage_events')) {
    throw new Error('Only the event owner can perform this action')
  }
}

export async function getAuthEmailPhone(uid: string): Promise<{ email: string | null; phone: string | null }> {
  try {
    const record = await adminAuth.getUser(uid)
    const email = record.email ? String(record.email).toLowerCase() : null
    const phone = record.phoneNumber ? String(record.phoneNumber) : null
    return { email, phone }
  } catch {
    return { email: null, phone: null }
  }
}

export function normalizePermissions(input: any): EventInvitePermissions {
  return {
    checkin: true,
    viewAttendees: Boolean(input?.viewAttendees),
  }
}

export function expiresIn48h(): Timestamp {
  return Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000)
}

export const serverTimestamp = () => FieldValue.serverTimestamp()
