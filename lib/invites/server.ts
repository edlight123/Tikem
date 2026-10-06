/**
 * Invites: the Firestore side (Admin SDK, server only). Every rule lives in
 * ./policy.ts; this file gathers inputs, writes the records and sends the
 * notifications. Collections, all server-only (firestore.rules default deny):
 *
 *   event_invites/{eventId}__{inviterUid}__{targetUid}
 *       { event_id, inviter_uid, target_uid, created_at, status: 'sent' | 'purchased' }
 *   invite_codes/{code}            { uid, created_at }        one code per user
 *   invite_code_owners/{uid}       { code, created_at }       reverse index
 *   invite_attributions/{newUid}   { inviter_uid, code, event_id, claimed_at }  written once, ever
 *   invite_purchases/{eventId}__{buyerUid}
 *       { inviter_uid, buyer_uid, event_id, source, order_key, ticket_count, created_at }
 *   users/{uid}/invite_mutes/{inviterUid}  { inviter_uid, created_at }  owner-readable
 *
 * Privacy: nothing here returns an email or a phone number. The picker only
 * ever lists the caller's own accepted connections, and a friend who muted the
 * caller shows as "unavailable", never as "muted".
 */

import { randomBytes } from 'node:crypto'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { consumeRateLimit } from '@/lib/rate-limit'
import { BLOCKED_ORGANIZERS_SUBCOLLECTION, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import {
  getAcceptedFriendIds,
  getPublicUserSummaries,
  sendConnectionRequest,
} from '@/lib/firestore/connections'
import { createNotification } from '@/lib/notifications/helpers'
import { decideSend } from '@/lib/notifications/policy'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { isSocialFlagOn } from '@/lib/social/flags'
import type { PublicUserSummary } from '@/types/social'
import { normalizeAttendanceVisibility } from '@/types/social'
import {
  DAY_MS,
  INVITE_CAPS,
  type InviteFacts,
  type InvitePickerState,
  type InviteSkipReason,
  attributionApplies,
  eventInviteDocId,
  firstName,
  inviteCodeFromBytes,
  isEventInvitable,
  isNewAccount,
  isSafeId,
  normalizeInviteCode,
  pickerStateFor,
  planInvites,
  toMs,
} from './policy'
import { eventWeekday, inviteCopy, langOf } from './copy'

export const COLLECTIONS = {
  eventInvites: 'event_invites',
  codes: 'invite_codes',
  codeOwners: 'invite_code_owners',
  attributions: 'invite_attributions',
  purchases: 'invite_purchases',
  mutes: 'invite_mutes',
} as const

/** The picker reads at most this many connections. */
const MAX_PICKER_FRIENDS = 500

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function getAll(refs: any[]): Promise<any[]> {
  if (refs.length === 0) return []
  return adminDb.getAll(...refs)
}

async function existingAmong(refs: any[], ids: string[]): Promise<Set<string>> {
  const docs = await getAll(refs)
  const out = new Set<string>()
  docs.forEach((d: any, i: number) => {
    if (d?.exists) out.add(ids[i])
  })
  return out
}

async function loadEvent(eventId: string): Promise<Record<string, any> | null> {
  if (!isSafeId(eventId)) return null
  const snap = await adminDb.collection('events').doc(eventId).get()
  return snap.exists ? (snap.data() as Record<string, any>) || {} : null
}

/** Of `ids`, those holding a LIVE ticket to `eventId` (current holder only). */
async function liveHolders(eventId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (ids.length === 0) return out
  const queries: Promise<any>[] = []
  for (const part of chunk(ids, 30)) {
    queries.push(adminDb.collection('tickets').where('event_id', '==', eventId).where('attendee_id', 'in', part).get())
    queries.push(adminDb.collection('tickets').where('event_id', '==', eventId).where('user_id', 'in', part).get())
  }
  const snaps = await Promise.all(queries)
  snaps.forEach((snap: any) =>
    snap.docs.forEach((doc: any) => {
      const data = doc.data() || {}
      if (!isLiveTicketStatus(data.status)) return
      const holder = data.attendee_id || data.user_id
      if (typeof holder === 'string' && ids.includes(holder)) out.add(holder)
    })
  )
  return out
}

/** Everything the invite rules need about `candidates`, from the inviter's side. */
async function inviteFacts(
  inviterUid: string,
  eventId: string,
  candidates: string[]
): Promise<Omit<InviteFacts, 'accepted'>> {
  const users = adminDb.collection('users')
  const [alreadyInvited, holders, mutedBy, blockedMe, myBlocks] = await Promise.all([
    existingAmong(
      candidates.map((c) => adminDb.collection(COLLECTIONS.eventInvites).doc(eventInviteDocId(eventId, inviterUid, c))),
      candidates
    ),
    liveHolders(eventId, candidates),
    existingAmong(
      candidates.map((c) => users.doc(c).collection(COLLECTIONS.mutes).doc(inviterUid)),
      candidates
    ),
    existingAmong(
      candidates.map((c) => users.doc(c).collection(BLOCKED_ORGANIZERS_SUBCOLLECTION).doc(inviterUid)),
      candidates
    ),
    getBlockedOrganizerIds(inviterUid),
  ])
  const blocked = new Set<string>(blockedMe)
  candidates.forEach((c) => {
    if (myBlocks.has(c)) blocked.add(c)
  })
  // A friend who keeps their attendance private ('nobody') must not be shown
  // as "going": report them as merely unavailable, like a mute or a block.
  const holderIds = Array.from(holders)
  if (holderIds.length > 0) {
    const docs = await adminDb.getAll(...holderIds.map((id) => users.doc(id)))
    docs.forEach((d: any) => {
      const vis = normalizeAttendanceVisibility(d?.exists ? d.data()?.privacy?.attendance_visibility : undefined)
      if (vis === 'nobody') {
        holders.delete(d.id)
        blocked.add(d.id)
      }
    })
  }
  return { alreadyInvited, holders, mutedBy, blocked }
}

// ── Feature 1: invite connections to an event ───────────────────────────────

export interface InvitePickerFriend extends PublicUserSummary {
  state: InvitePickerState
}

export type PickerResult =
  | { ok: true; friends: InvitePickerFriend[] }
  | { ok: false; code: 'event_not_found' | 'event_unavailable' }

export async function getInvitePicker(inviterUid: string, eventId: string, now = new Date()): Promise<PickerResult> {
  const event = await loadEvent(eventId)
  if (!event) return { ok: false, code: 'event_not_found' }
  if (!isEventInvitable(event, now)) return { ok: false, code: 'event_unavailable' }

  const friendIds = (await getAcceptedFriendIds(inviterUid)).slice(0, MAX_PICKER_FRIENDS)
  if (friendIds.length === 0) return { ok: true, friends: [] }

  const [facts, summaries] = await Promise.all([
    inviteFacts(inviterUid, eventId, friendIds),
    getPublicUserSummaries(friendIds),
  ])
  const friends = friendIds
    .map((uid) => {
      const s = summaries.get(uid)
      if (!s) return null
      // Public display fields only: never email or phone.
      const item: InvitePickerFriend = {
        uid,
        displayName: s.displayName,
        photoURL: s.photoURL || '',
        isVerified: Boolean(s.isVerified),
        state: pickerStateFor(uid, facts),
      }
      return item
    })
    .filter((f): f is InvitePickerFriend => f !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  return { ok: true, friends }
}

export type ConsumeFn = (opts: { key: string; limit: number; windowMs: number; cost?: number }) => Promise<{
  limited: boolean
}>

export interface SendInvitesDeps {
  consume?: ConsumeFn
  notify?: (n: InviteNotification) => Promise<void>
  now?: Date
}

export interface InviteNotification {
  targetUid: string
  inviterUid: string
  inviterName: string
  eventId: string
  event: Record<string, any>
}

export type SendInvitesResult =
  | { status: 'ok'; sent: string[]; skipped: Array<{ uid: string; reason: InviteSkipReason }> }
  | { status: 'event_not_found' | 'event_unavailable' | 'not_connected' | 'rate_limited' }

export const inviteCapKeys = (inviterUid: string, eventId: string) => ({
  perEvent: `invites:event:${eventId}:uid:${inviterUid}`,
  perDay: `invites:day:uid:${inviterUid}`,
})

export async function sendEventInvites(
  params: { inviterUid: string; inviterName?: string | null; eventId: string; friendIds: string[] },
  deps: SendInvitesDeps = {}
): Promise<SendInvitesResult> {
  const { inviterUid, eventId, friendIds } = params
  const now = deps.now || new Date()
  const consume: ConsumeFn = deps.consume || ((o) => consumeRateLimit(o))
  const notify = deps.notify || notifyInviteTarget

  const event = await loadEvent(eventId)
  if (!event) return { status: 'event_not_found' }
  if (!isEventInvitable(event, now)) return { status: 'event_unavailable' }

  const accepted = new Set(await getAcceptedFriendIds(inviterUid))
  const connected = friendIds.filter((id) => accepted.has(id))
  const facts = await inviteFacts(inviterUid, eventId, connected)
  const plan = planInvites(friendIds, { accepted, ...facts })
  if (plan.notConnected.length > 0) return { status: 'not_connected' }
  if (plan.send.length === 0) return { status: 'ok', sent: [], skipped: plan.skipped }

  // Daily caps, charged for the invites actually going out. Per event first:
  // the tighter one, so a refusal there does not burn the global budget.
  const keys = inviteCapKeys(inviterUid, eventId)
  const cost = plan.send.length
  const perEvent = await consume({ key: keys.perEvent, limit: INVITE_CAPS.perEventPerDay, windowMs: DAY_MS, cost })
  if (perEvent.limited) return { status: 'rate_limited' }
  const perDay = await consume({ key: keys.perDay, limit: INVITE_CAPS.perDay, windowMs: DAY_MS, cost })
  if (perDay.limited) return { status: 'rate_limited' }

  const sent: string[] = []
  const skipped = [...plan.skipped]
  const inviterName = String(params.inviterName || '').trim()
  for (const targetUid of plan.send) {
    const ref = adminDb.collection(COLLECTIONS.eventInvites).doc(eventInviteDocId(eventId, inviterUid, targetUid))
    // Create-if-absent: a double tap or a second device cannot invite twice.
    const created = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (snap.exists) return false
      tx.set(ref, {
        event_id: eventId,
        inviter_uid: inviterUid,
        target_uid: targetUid,
        created_at: now,
        status: 'sent',
      })
      return true
    })
    if (!created) {
      skipped.push({ uid: targetUid, reason: 'already_invited' })
      continue
    }
    sent.push(targetUid)
    try {
      await notify({ targetUid, inviterUid, inviterName, eventId, event })
    } catch (err) {
      console.error('[invites] notify failed', (err as any)?.message)
    }
  }
  return { status: 'ok', sent, skipped }
}

async function loadUser(uid: string): Promise<Record<string, any> | null> {
  try {
    const snap = await adminDb.collection('users').doc(uid).get()
    return snap.exists ? (snap.data() as Record<string, any>) || {} : null
  } catch {
    return null
  }
}

/**
 * In-app notification always (it is the record of the invite, and carries the
 * "mute" action); push only when the target's discretionary 'friend_invite'
 * preference and quiet hours allow it (lib/notifications/policy.ts).
 */
export async function notifyInviteTarget(n: InviteNotification): Promise<void> {
  const target = await loadUser(n.targetUid)
  const lang = langOf(target)
  const copy = inviteCopy(lang)
  const name = firstName(n.inviterName, copy.someone)
  const title = String(n.event?.title || 'Tikèm')
  const body = copy.invite(name, title, eventWeekday(n.event, lang))
  const url = `/events/${n.eventId}`
  const metadata = { eventId: n.eventId, inviterId: n.inviterUid, inviterName: name, kind: 'event_invite' }
  await createNotification(n.targetUid, 'friend_invite', copy.inviteTitle, body, url, metadata)
  if (decideSend({ user: target, category: 'friend_invite' }).send) {
    const { sendPushNotification } = await import('@/lib/notification-triggers')
    await sendPushNotification(n.targetUid, copy.inviteTitle, body, url, { type: 'friend_invite', ...metadata })
  }
}

// ── Mutes ───────────────────────────────────────────────────────────────────

function muteRef(uid: string, inviterUid: string) {
  return adminDb.collection('users').doc(uid).collection(COLLECTIONS.mutes).doc(inviterUid)
}

export async function muteInviter(uid: string, inviterUid: string, now = new Date()): Promise<void> {
  await muteRef(uid, inviterUid).set({ inviter_uid: inviterUid, created_at: now })
}

export async function unmuteInviter(uid: string, inviterUid: string): Promise<void> {
  await muteRef(uid, inviterUid).delete()
}

// ── Feature 2: invite links ─────────────────────────────────────────────────

/** The caller's one invite code, created on first use. */
export async function getOrCreateInviteCode(
  uid: string,
  gen: () => string = () => inviteCodeFromBytes(randomBytes(16)),
  now = new Date()
): Promise<string> {
  const ownerRef = adminDb.collection(COLLECTIONS.codeOwners).doc(uid)
  const existing = await ownerRef.get()
  const known = existing.exists ? normalizeInviteCode(existing.data()?.code) : null
  if (known) return known

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = gen()
    const codeRef = adminDb.collection(COLLECTIONS.codes).doc(code)
    const result = await adminDb.runTransaction(async (tx: any) => {
      const owner = await tx.get(ownerRef)
      const ownerCode = owner.exists ? normalizeInviteCode(owner.data()?.code) : null
      if (ownerCode) return ownerCode // a concurrent request won
      const taken = await tx.get(codeRef)
      if (taken.exists) return null // collision: try another
      tx.set(codeRef, { uid, created_at: now })
      tx.set(ownerRef, { code, created_at: now })
      return code
    })
    if (result) return result
  }
  throw new Error('invite_code_unavailable')
}

export async function resolveInviteCode(raw: unknown): Promise<string | null> {
  const code = normalizeInviteCode(raw)
  if (!code) return null
  const snap = await adminDb.collection(COLLECTIONS.codes).doc(code).get()
  const uid = snap.exists ? snap.data()?.uid : null
  return typeof uid === 'string' && uid ? uid : null
}

export async function eventExists(eventId: string): Promise<boolean> {
  return (await loadEvent(eventId)) !== null
}

export type ClaimStatus = 'claimed' | 'already_claimed' | 'invalid_code' | 'self' | 'not_new'

export interface ClaimDeps {
  now?: number
  /** Account creation time; defaults to Firebase Auth metadata. */
  accountCreatedAt?: (uid: string) => Promise<unknown>
  notify?: (inviterUid: string, newUid: string) => Promise<void>
}

async function authCreationTime(uid: string): Promise<unknown> {
  const record = await adminAuth.getUser(uid)
  return record?.metadata?.creationTime || null
}

/**
 * Attribute a NEW account to the invite it arrived through, once ever, and
 * make the two of them friends (unless either blocked the other).
 */
export async function claimInvite(
  params: { uid: string; code: unknown; eventId?: unknown },
  deps: ClaimDeps = {}
): Promise<{ status: ClaimStatus; inviterUid?: string }> {
  const now = deps.now ?? Date.now()
  const code = normalizeInviteCode(params.code)
  if (!code) return { status: 'invalid_code' }
  const inviterUid = await resolveInviteCode(code)
  if (!inviterUid) return { status: 'invalid_code' }
  if (inviterUid === params.uid) return { status: 'self' }

  const ref = adminDb.collection(COLLECTIONS.attributions).doc(params.uid)
  // Cheap early exit before the auth lookup.
  if ((await ref.get()).exists) return { status: 'already_claimed' }

  const created = await (deps.accountCreatedAt || authCreationTime)(params.uid).catch(() => null)
  if (!isNewAccount(created, now)) return { status: 'not_new' }

  const eventId = isSafeId(params.eventId) && (await eventExists(params.eventId)) ? params.eventId : null

  const claimed = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (snap.exists) return false // never overwrite
    tx.set(ref, { inviter_uid: inviterUid, code, event_id: eventId, claimed_at: new Date(now) })
    return true
  })
  if (!claimed) return { status: 'already_claimed' }

  // Ask, never force: invite links get forwarded, so joining through one must
  // not make a stranger the inviter's friend (friends see attendance). The new
  // user sends a request the inviter accepts with one tap; if the inviter had
  // already requested them, that consent completes it.
  try {
    const [blockedByNew, blockedByInviter] = await Promise.all([
      adminDb.collection('users').doc(params.uid).collection(BLOCKED_ORGANIZERS_SUBCOLLECTION).doc(inviterUid).get(),
      adminDb.collection('users').doc(inviterUid).collection(BLOCKED_ORGANIZERS_SUBCOLLECTION).doc(params.uid).get(),
    ])
    if (!blockedByNew.exists && !blockedByInviter.exists) {
      await sendConnectionRequest(params.uid, inviterUid)
    }
  } catch (err) {
    console.error('[invites] auto-connect failed', (err as any)?.message)
  }

  try {
    await (deps.notify || notifyInviterJoined)(inviterUid, params.uid)
  } catch (err) {
    console.error('[invites] joined notification failed', (err as any)?.message)
  }
  return { status: 'claimed', inviterUid }
}

async function displayNameOf(uid: string): Promise<string> {
  const user = await loadUser(uid)
  const fromDoc = user?.full_name || user?.display_name || user?.displayName
  if (fromDoc) return String(fromDoc)
  try {
    return String((await adminAuth.getUser(uid))?.displayName || '')
  } catch {
    return ''
  }
}

export async function notifyInviterJoined(inviterUid: string, newUid: string): Promise<void> {
  const inviter = await loadUser(inviterUid)
  const lang = langOf(inviter)
  const copy = inviteCopy(lang)
  const name = firstName(await displayNameOf(newUid), copy.someone)
  const body = copy.joined(name)
  const url = '/connections'
  const metadata = { actorId: newUid, kind: 'invite_joined' }
  await createNotification(inviterUid, 'invite_joined', copy.joinedTitle, body, url, metadata)
  if (decideSend({ user: inviter, category: 'friend_invite' }).send) {
    const { sendPushNotification } = await import('@/lib/notification-triggers')
    await sendPushNotification(inviterUid, copy.joinedTitle, body, url, { type: 'invite_joined', ...metadata })
  }
}

// ── Feature 3: tracking ─────────────────────────────────────────────────────

export interface InvitePurchaseInput {
  buyerUid: string | null | undefined
  eventId: string
  ticketIds: string[]
  orderKey: string
  /** Order docs to stamp too (stripe_orders / pending_transactions refs), or a
   *  lazy lookup run only when there is someone to credit. */
  orderRefs?: any[] | (() => Promise<any[]>)
  now?: number
  /** Tests skip the remote switch. */
  skipFlag?: boolean
}

/**
 * Credit a completed order to whoever invited the buyer. Called from the
 * shared fulfilment paths AFTER tickets exist. Never throws and never blocks:
 * a bookkeeping failure must not fail a paid order.
 *
 * Credit goes to (1) the invite link the buyer joined through, when it was for
 * this event or the buyer joined within 30 days, else (2) the first connection
 * who invited them to this event. Every event invite to the buyer for this
 * event is marked 'purchased' either way.
 */
export async function recordInvitePurchase(input: InvitePurchaseInput): Promise<string | null> {
  try {
    const buyer = String(input.buyerUid || '')
    if (!buyer || buyer.startsWith('guest_') || !isSafeId(input.eventId)) return null
    if (!input.skipFlag && !(await isSocialFlagOn('invites'))) return null
    const now = input.now ?? Date.now()

    const [attrSnap, invitesSnap] = await Promise.all([
      adminDb.collection(COLLECTIONS.attributions).doc(buyer).get(),
      adminDb
        .collection(COLLECTIONS.eventInvites)
        .where('event_id', '==', input.eventId)
        .where('target_uid', '==', buyer)
        .get(),
    ])

    let inviter: string | null = null
    let source: 'invite_link' | 'event_invite' | null = null
    const attr = attrSnap.exists ? attrSnap.data() : null
    if (attributionApplies(attr, input.eventId, now)) {
      inviter = String(attr.inviter_uid)
      source = 'invite_link'
    }

    const invites = (invitesSnap.docs || [])
      .map((d: any) => ({ ref: d.ref, data: d.data() || {} }))
      .sort((a: any, b: any) => (toMs(a.data.created_at) ?? 0) - (toMs(b.data.created_at) ?? 0))
    if (!inviter && invites.length > 0) {
      inviter = String(invites[0].data.inviter_uid || '') || null
      source = inviter ? 'event_invite' : null
    }
    await Promise.all(
      invites
        .filter((i: any) => i.data.status !== 'purchased')
        .map((i: any) =>
          i.ref.set({ status: 'purchased', purchased_at: new Date(now) }, { merge: true }).catch(() => undefined)
        )
    )
    if (!inviter || inviter === buyer) return null

    const stamp = { invite_inviter_uid: inviter, invite_source: source }
    const orderRefs =
      typeof input.orderRefs === 'function' ? await input.orderRefs().catch(() => []) : input.orderRefs || []
    await Promise.all([
      ...input.ticketIds.map((id) =>
        adminDb.collection('tickets').doc(String(id)).set(stamp, { merge: true }).catch(() => undefined)
      ),
      ...orderRefs.map((ref: any) => ref.set(stamp, { merge: true }).catch(() => undefined)),
    ])

    // One ledger row per buyer per event: "who bought", not "how many orders".
    const ledgerRef = adminDb.collection(COLLECTIONS.purchases).doc(`${input.eventId}__${buyer}`)
    await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ledgerRef)
      if (snap.exists) return
      tx.set(ledgerRef, {
        inviter_uid: inviter,
        buyer_uid: buyer,
        event_id: input.eventId,
        source,
        order_key: input.orderKey,
        ticket_count: input.ticketIds.length,
        created_at: new Date(now),
      })
    })
    return inviter
  } catch (err) {
    console.error('[invites] purchase attribution failed', (err as any)?.message)
    return null
  }
}

async function countOf(query: any): Promise<number> {
  if (typeof query.count === 'function') {
    const snap = await query.count().get()
    return Number(snap.data()?.count) || 0
  }
  const snap = await query.get()
  return Number(snap.size) || 0
}

export interface InviteSummary {
  sent: number
  joined: number
  purchased: number
}

/** The caller's own invite results. Counts only, no names. */
export async function getInviteSummary(uid: string): Promise<InviteSummary> {
  const [sent, joined, purchased] = await Promise.all([
    countOf(adminDb.collection(COLLECTIONS.eventInvites).where('inviter_uid', '==', uid)),
    countOf(adminDb.collection(COLLECTIONS.attributions).where('inviter_uid', '==', uid)),
    countOf(adminDb.collection(COLLECTIONS.purchases).where('inviter_uid', '==', uid)),
  ])
  return { sent, joined, purchased }
}

/** Platform totals for the admin analytics line. */
export async function getInviteTotals(): Promise<InviteSummary> {
  const [sent, joined, purchased] = await Promise.all([
    countOf(adminDb.collection(COLLECTIONS.eventInvites)),
    countOf(adminDb.collection(COLLECTIONS.attributions)),
    countOf(adminDb.collection(COLLECTIONS.purchases)),
  ])
  return { sent, joined, purchased }
}
