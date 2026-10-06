/**
 * Server-side friend connection operations (Firebase Admin SDK).
 *
 * A "connection" is a mutual friendship between two users. We store one
 * document per pair in the `connections` collection, with a deterministic id
 * so duplicate requests are impossible and either direction resolves to the
 * same document.
 *
 * All mutations go through these helpers (called from API routes), mirroring
 * the existing organizer-follow pattern. Client writes are disabled in rules.
 */

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  type Connection,
  type ConnectionStatus,
  type FriendshipState,
  type PublicUserSummary,
  connectionIdFor,
  phoneToE164,
} from '@/types/social'

const COLLECTION = 'connections'

function toIso(value: any): string {
  if (!value) return new Date().toISOString()
  if (typeof value === 'string') return value
  if (value?.toDate) return value.toDate().toISOString()
  return new Date().toISOString()
}

function mapConnection(doc: any): Connection {
  const data = doc.data() || {}
  return {
    id: doc.id,
    users: data.users || [data.requester_id, data.recipient_id],
    requester_id: data.requester_id,
    recipient_id: data.recipient_id,
    status: (data.status as ConnectionStatus) || 'pending',
    created_at: toIso(data.created_at),
    updated_at: toIso(data.updated_at),
    accepted_at: data.accepted_at ? toIso(data.accepted_at) : null,
  }
}

/**
 * Fetch lightweight, privacy-safe public summaries for a set of user ids.
 * Batches Firestore `in` queries (max 30 ids each).
 */
export async function getPublicUserSummaries(
  userIds: string[]
): Promise<Map<string, PublicUserSummary>> {
  const result = new Map<string, PublicUserSummary>()
  const unique = Array.from(new Set(userIds.filter(Boolean)))
  if (unique.length === 0) return result

  // Resolve users by document reference (getAll) rather than a
  // `where('__name__', 'in', chunk)` query: filtering on the documentId
  // requires Key values, not bare id strings, so passing plain ids throws
  // "__key__ filter value must be a Key". getAll takes plain refs, has no
  // 30-item cap, and returns missing docs with `exists === false`.
  const refs = unique.map((id) => adminDb.collection('users').doc(id))
  const docs = await adminDb.getAll(...refs)

  docs.forEach((doc: any) => {
    if (!doc.exists) return
    const data = doc.data() || {}
    result.set(doc.id, {
      uid: doc.id,
      displayName: data.full_name || data.display_name || data.displayName || 'Tikèm user',
      photoURL: data.photo_url || data.photoURL || '',
      isVerified: Boolean(data.is_verified),
    })
  })

  return result
}

/** Get the raw connection document between two users, if any. */
export async function getConnectionBetween(a: string, b: string): Promise<Connection | null> {
  const id = connectionIdFor(a, b)
  const doc = await adminDb.collection(COLLECTION).doc(id).get()
  return doc.exists ? mapConnection(doc) : null
}

/** Resolve the viewer's friendship state with another user. */
export function friendshipStateFrom(
  connection: Connection | null,
  viewerId: string,
  otherId: string
): FriendshipState {
  if (viewerId === otherId) return 'self'
  if (!connection) return 'none'
  if (connection.status === 'accepted') return 'friends'
  // pending
  return connection.requester_id === viewerId ? 'request_sent' : 'request_received'
}

export async function getFriendshipState(
  viewerId: string,
  otherId: string
): Promise<FriendshipState> {
  if (viewerId === otherId) return 'self'
  const connection = await getConnectionBetween(viewerId, otherId)
  return friendshipStateFrom(connection, viewerId, otherId)
}

/** Return the set of user ids that are accepted friends of `userId`. */
export async function getAcceptedFriendIds(userId: string): Promise<string[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('users', 'array-contains', userId)
    .where('status', '==', 'accepted')
    .get()

  const ids = new Set<string>()
  snap.docs.forEach((doc: any) => {
    const data = doc.data() || {}
    const other = (data.users || []).find((u: string) => u !== userId)
    if (other) ids.add(other)
  })
  return Array.from(ids)
}

/**
 * Build a map of (otherUserId → Connection) for every connection the viewer is
 * part of. Useful for resolving friendship state across many users at once.
 */
export async function mapConnectionsForViewer(userId: string): Promise<Map<string, Connection>> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('users', 'array-contains', userId)
    .get()

  const map = new Map<string, Connection>()
  snap.docs.forEach((doc: any) => {
    const conn = mapConnection(doc)
    const other = conn.users.find((u) => u !== userId)
    if (other) map.set(other, conn)
  })
  return map
}

export interface SendRequestResult {
  ok: boolean
  status: FriendshipState
  error?: string
}

/**
 * Send (or auto-accept) a friend request from `requesterId` to `recipientId`.
 * If the recipient had already sent a pending request, this accepts it.
 */
export async function sendConnectionRequest(
  requesterId: string,
  recipientId: string
): Promise<SendRequestResult> {
  if (requesterId === recipientId) {
    return { ok: false, status: 'self', error: 'You cannot connect with yourself' }
  }

  const id = connectionIdFor(requesterId, recipientId)
  const ref = adminDb.collection(COLLECTION).doc(id)
  const existing = await ref.get()

  if (existing.exists) {
    const conn = mapConnection(existing)
    if (conn.status === 'accepted') {
      return { ok: true, status: 'friends' }
    }
    // There is a pending request already.
    if (conn.requester_id === requesterId) {
      return { ok: true, status: 'request_sent' }
    }
    // The other person already requested us → accept it.
    await ref.update({
      status: 'accepted',
      accepted_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    })
    return { ok: true, status: 'friends' }
  }

  await ref.set({
    users: [requesterId, recipientId].sort(),
    requester_id: requesterId,
    recipient_id: recipientId,
    status: 'pending',
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    accepted_at: null,
  })

  return { ok: true, status: 'request_sent' }
}

/** Accept or decline a pending request directed at `userId`. */
export async function respondToConnectionRequest(
  userId: string,
  otherId: string,
  action: 'accept' | 'decline'
): Promise<{ ok: boolean; status: FriendshipState; error?: string }> {
  const id = connectionIdFor(userId, otherId)
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()

  if (!snap.exists) {
    return { ok: false, status: 'none', error: 'Request not found' }
  }

  const conn = mapConnection(snap)
  if (conn.status === 'accepted') {
    return { ok: true, status: 'friends' }
  }

  // Only the recipient of a pending request may respond.
  if (conn.recipient_id !== userId) {
    return { ok: false, status: friendshipStateFrom(conn, userId, otherId), error: 'Not authorized to respond' }
  }

  if (action === 'accept') {
    await ref.update({
      status: 'accepted',
      accepted_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    })
    return { ok: true, status: 'friends' }
  }

  // decline → remove the request entirely
  await ref.delete()
  return { ok: true, status: 'none' }
}

/** Remove an existing friendship or cancel a pending request. */
export async function removeConnection(
  userId: string,
  otherId: string
): Promise<{ ok: boolean }> {
  const id = connectionIdFor(userId, otherId)
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { ok: true }

  const conn = mapConnection(snap)
  // Only a participant can remove.
  if (!conn.users.includes(userId)) return { ok: false }

  await ref.delete()
  return { ok: true }
}

export interface ConnectionsOverview {
  friends: PublicUserSummary[]
  incoming: PublicUserSummary[] // pending requests waiting on the user
  outgoing: PublicUserSummary[] // pending requests the user sent
}

/** Build the full friends + pending requests overview for a user. */
export async function getConnectionsOverview(userId: string): Promise<ConnectionsOverview> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('users', 'array-contains', userId)
    .get()

  const friendIds: string[] = []
  const incomingIds: string[] = []
  const outgoingIds: string[] = []

  snap.docs.forEach((doc: any) => {
    const conn = mapConnection(doc)
    const other = conn.users.find((u) => u !== userId)
    if (!other) return
    if (conn.status === 'accepted') {
      friendIds.push(other)
    } else if (conn.recipient_id === userId) {
      incomingIds.push(other)
    } else {
      outgoingIds.push(other)
    }
  })

  const summaries = await getPublicUserSummaries([...friendIds, ...incomingIds, ...outgoingIds])

  const pick = (ids: string[]) =>
    ids
      .map((id) => summaries.get(id))
      .filter((s): s is PublicUserSummary => Boolean(s))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

  return {
    friends: pick(friendIds),
    incoming: pick(incomingIds),
    outgoing: pick(outgoingIds),
  }
}

export interface ContactMatch extends PublicUserSummary {
  friendship: FriendshipState
}

/**
 * Match a list of phone numbers (from the user's contacts) against discoverable
 * Tikèm users. Only returns users who allow phone discovery and excludes the
 * caller. Each match includes the current friendship state so the UI can render
 * the right action.
 */
export async function matchContacts(
  userId: string,
  phoneNumbers: string[]
): Promise<ContactMatch[]> {
  // Exact E.164 only, and only against VERIFIED numbers: Firebase Auth's
  // phoneNumber is set solely by a completed OTP (sign-in or link), whereas the
  // profile `phone` field is free text anyone can type someone else's number
  // into. A last-8-digit match against that field let a caller learn which
  // account claimed a number, and sweep a suffix across every country code.
  const numbers = Array.from(
    new Set(phoneNumbers.map((p) => phoneToE164(p)).filter(Boolean))
  )
  if (numbers.length === 0) return []

  // getUsers accepts at most 100 identifiers per call.
  const uids = new Set<string>()
  for (let i = 0; i < numbers.length; i += 100) {
    const chunk = numbers.slice(i, i + 100).map((phoneNumber) => ({ phoneNumber }))
    const result = await adminAuth.getUsers(chunk)
    for (const u of result.users as any[]) {
      if (u.uid !== userId && !u.disabled && u.phoneNumber) uids.add(u.uid)
    }
  }
  if (uids.size === 0) return []

  const refs = Array.from(uids).map((uid) => adminDb.collection('users').doc(uid))
  const docs: any[] = await adminDb.getAll(...refs)

  const matchedUsers = new Map<string, any>()
  docs.forEach((doc: any) => {
    if (!doc.exists) return
    const data = doc.data() || {}
    // Respect discovery preference (defaults to true when unset).
    if (data.privacy?.discoverable_by_phone === false) return
    matchedUsers.set(doc.id, data)
  })

  const matchedIds = Array.from(matchedUsers.keys())
  if (matchedIds.length === 0) return []

  // Resolve friendship state for each match.
  const connectionsSnap = await adminDb
    .collection(COLLECTION)
    .where('users', 'array-contains', userId)
    .get()

  const connByOther = new Map<string, Connection>()
  connectionsSnap.docs.forEach((doc: any) => {
    const conn = mapConnection(doc)
    const other = conn.users.find((u) => u !== userId)
    if (other) connByOther.set(other, conn)
  })

  return matchedIds.map((id) => {
    const data = matchedUsers.get(id)
    const conn = connByOther.get(id) || null
    return {
      uid: id,
      displayName: data.full_name || data.display_name || data.displayName || 'Tikèm user',
      photoURL: data.photo_url || data.photoURL || '',
      isVerified: Boolean(data.is_verified),
      friendship: friendshipStateFrom(conn, userId, id),
    }
  })
}
