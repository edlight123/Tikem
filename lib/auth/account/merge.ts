/**
 * Account merge: fold a SOURCE account into a TARGET account, server-side.
 *
 * Why it exists: a person who signs in with their phone gets a phone-only
 * account. If they already had a Tikèm account under their email (or the
 * other way round), they now own two. Merging moves everything the person
 * owns onto ONE account, then retires the other so nothing is split again.
 *
 * Who wins (the TARGET):
 *   - phone account adds an email owned by another account: the EMAIL account
 *     (the older one, and the one their organizer data, if any, lives on);
 *   - signed-in account adds a phone owned by another account: the SIGNED-IN
 *     account.
 * The caller decides; this module only needs (source, target).
 *
 * What moves (person-level data):
 *   tickets (user_id / attendee_id), orders (pending_transactions.user_id,
 *   guest_orders.claimed_by_uid), ticket transfers (from/to), favorites
 *   (favorites, event_favorites), organizer follows, friendships (connections),
 *   reviews, web-push subscriptions, push tokens + in-app notifications +
 *   blocks + invite mutes (users/{uid} subcollections), org TEAM memberships
 *   (organizers/{org}/team + the users/{uid}/org_memberships mirror), event
 *   door-staff memberships (events/{id}/members), promoter links, community
 *   shares and event claims, and profile bits the target is missing (name,
 *   photo, bio, city/country, language).
 *
 * What NEVER moves: organizer MONEY. An organization's id IS its owner's uid
 * (events.organizer_id, earnings, withdrawals, Stripe/MonCash payout settings,
 * payout history all key on it), so "moving" an org means rewriting money
 * ledgers. If the SOURCE owns an organization with events, money, payout
 * settings or a team, the merge stops at `needs_review`, writes an admin
 * review item (account_merge_reviews) and the person is told to contact
 * support. A target that is an organizer is fine: it stays the org owner.
 *
 * Guarantees:
 *   - Idempotent: every step re-queries by the SOURCE uid, so a retry after a
 *     crash picks up exactly what is left. A completed merge answers
 *     `completed` again without touching anything.
 *   - Exclusive: a lease in account_merges/{source__target} stops two
 *     concurrent runs.
 *   - Never loses tickets: tickets are moved FIRST, in batches; Auth changes
 *     (phone moved, source disabled) happen LAST, so a failure part-way leaves
 *     both accounts signed-in-able and the retry finishes the job.
 *   - Audit: account_merges/{id} records status, proofs, timestamps and counts
 *     (no PII beyond uids).
 */

import { connectionIdFor } from '@/types/social'
import { pickPublicProfileFields } from '@/lib/firestore/public-profile-fields'

export const MERGES = 'account_merges'
export const MERGE_REVIEWS = 'account_merge_reviews'

/** How long one run may hold the lease before another may take over. */
const LEASE_MS = 2 * 60 * 1000

/** The slice of firebase-admin Auth the merge needs. */
export interface MergeAuthAdmin {
  getUser(uid: string): Promise<{ uid: string; email?: string; emailVerified?: boolean; phoneNumber?: string; disabled?: boolean }>
  updateUser(uid: string, props: Record<string, unknown>): Promise<unknown>
  revokeRefreshTokens(uid: string): Promise<unknown>
}

export type MergeReason = 'phone_account_added_email' | 'account_added_phone'

export type MergeProof = 'email_code' | 'phone_code' | 'fresh_signin'

export interface MergeRequest {
  sourceUid: string
  targetUid: string
  reason: MergeReason
  /** How each side proved it is the same person (audit only). */
  proofs: { source: MergeProof; target: MergeProof }
  /** Who asked (audit only). */
  requestedBy: string
  now?: Date
}

export type MergeOutcome =
  | { status: 'completed'; mergeId: string; counts: Record<string, number>; movedPhone: string | null; alreadyDone?: boolean }
  | { status: 'needs_review'; mergeId: string; reviewId: string; reasons: string[] }
  | { status: 'blocked'; mergeId: string; code: 'target_has_other_phone' | 'account_disabled' | 'same_account' }
  | { status: 'busy'; mergeId: string }

export function mergeIdFor(sourceUid: string, targetUid: string): string {
  return `${sourceUid}__${targetUid}`
}

const isCode = (err: unknown, code: string) => (err as { code?: string })?.code === code

// ── Organizer footprint ─────────────────────────────────────────────────────

export interface OrgFootprint {
  /** organizers/{uid} exists. */
  hasOrgDoc: boolean
  events: number
  /** Earnings rows, withdrawals, payout settings, Stripe/MonCash ids, promoter wallet. */
  money: string[]
  /** Other people on this account's org team. */
  teamMembers: number
}

const MONEY_FIELDS = [
  'stripe_account_id',
  'stripeAccountId',
  'stripe_connect_account_id',
  'moncash_number',
  'moncashNumber',
  'payout_method',
  'payoutMethod',
]

/** What organization this uid OWNS (not merely belongs to). */
export async function orgFootprint(db: any, uid: string): Promise<OrgFootprint> {
  const orgRef = db.collection('organizers').doc(uid)
  const [orgSnap, events, earnings, withdrawals, wallet, profiles, destinations, payoutConfig, team] =
    await Promise.all([
      orgRef.get(),
      db.collection('events').where('organizer_id', '==', uid).get(),
      db.collection('event_earnings').where('organizerId', '==', uid).get(),
      db.collection('withdrawal_requests').where('organizerId', '==', uid).get(),
      db.collection('promoter_wallets').doc(uid).get(),
      orgRef.collection('payoutProfiles').get(),
      orgRef.collection('payoutDestinations').get(),
      orgRef.collection('payoutConfig').get(),
      orgRef.collection('team').get(),
    ])
  const org = orgSnap.exists ? orgSnap.data() || {} : {}
  const money: string[] = []
  if (!earnings.empty) money.push('earnings')
  if (!withdrawals.empty) money.push('withdrawals')
  if (wallet.exists) money.push('promoter_wallet')
  if (!profiles.empty || !destinations.empty || !payoutConfig.empty) money.push('payout_settings')
  if (MONEY_FIELDS.some((f) => org[f])) money.push('payout_account')
  const teamMembers = team.docs.filter((d: any) => d.id !== uid).length
  return { hasOrgDoc: orgSnap.exists, events: events.size, money, teamMembers }
}

/** Why the SOURCE's organization cannot be merged automatically (empty = it can). */
export function orgBlockers(source: OrgFootprint): string[] {
  const reasons: string[] = []
  if (source.events > 0) reasons.push('source_org_has_events')
  if (source.money.length) reasons.push('source_org_has_money')
  if (source.teamMembers > 0) reasons.push('source_org_has_team')
  return reasons
}

/**
 * Pre-flight, read-only: can these two accounts be merged without a human?
 * Used before the person is asked to confirm, and again inside the merge.
 */
export async function assessMerge(
  db: any,
  auth: MergeAuthAdmin,
  sourceUid: string,
  targetUid: string,
  opts: { requireVerifiedTargetEmail?: boolean } = {}
): Promise<
  | { ok: true; movePhone: string | null }
  | { ok: false; kind: 'review'; reasons: string[]; source: OrgFootprint; target: OrgFootprint }
  | { ok: false; kind: 'blocked'; code: 'target_has_other_phone' | 'account_disabled' | 'same_account' }
> {
  if (!sourceUid || !targetUid || sourceUid === targetUid) return { ok: false, kind: 'blocked', code: 'same_account' }
  const [src, tgt] = await Promise.all([auth.getUser(sourceUid), auth.getUser(targetUid)])
  if (tgt.disabled) return { ok: false, kind: 'blocked', code: 'account_disabled' }
  const movePhone = src.phoneNumber || null
  if (movePhone && tgt.phoneNumber && tgt.phoneNumber !== movePhone) {
    // Firebase holds one number per account. Moving would drop one of the two
    // sign-in numbers silently; the person has to choose, with support.
    return { ok: false, kind: 'blocked', code: 'target_has_other_phone' }
  }
  const [source, target] = await Promise.all([orgFootprint(db, sourceUid), orgFootprint(db, targetUid)])
  const reasons = orgBlockers(source)
  // Pre-hijack guard: when the target was found by its EMAIL, that email must
  // have been verified by whoever owns the target. Otherwise anyone could
  // register someone else's address unverified and wait for the real owner to
  // merge their account into it. Unverified => a human looks at it.
  if (opts.requireVerifiedTargetEmail && !tgt.emailVerified) reasons.push('target_email_unverified')
  if (reasons.length) {
    if (target.hasOrgDoc || target.events > 0) reasons.push('both_accounts_are_organizers')
    return { ok: false, kind: 'review', reasons, source, target }
  }
  return { ok: true, movePhone }
}

/** The admin queue row for a merge that needs a human (idempotent per pair). */
export async function openMergeReview(
  db: any,
  params: { sourceUid: string; targetUid: string; reasons: string[]; source: OrgFootprint; target: OrgFootprint; reason: MergeReason; nowIso: string }
): Promise<string> {
  const id = mergeIdFor(params.sourceUid, params.targetUid)
  const ref = db.collection(MERGE_REVIEWS).doc(id)
  const existing = await ref.get()
  if (existing.exists && (existing.data() || {}).status === 'pending') return id
  await ref.set(
    {
      status: 'pending',
      source_uid: params.sourceUid,
      target_uid: params.targetUid,
      reason: params.reason,
      blockers: params.reasons,
      source_org: params.source,
      target_org: params.target,
      created_at: existing.exists ? (existing.data() || {}).created_at ?? params.nowIso : params.nowIso,
      updated_at: params.nowIso,
    },
    { merge: true }
  )
  return id
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Unique docs across several equality queries on one collection. */
async function docsMatching(db: any, collection: string, clauses: Array<[string, unknown]>) {
  const seen = new Map<string, any>()
  for (const [field, value] of clauses) {
    const snap = await db.collection(collection).where(field, '==', value).get()
    for (const d of snap.docs) seen.set(d.ref._path ?? `${collection}/${d.id}`, d)
  }
  return Array.from(seen.values())
}

/** Commit writes in batches of <= 400 (Firestore's cap is 500). */
async function inBatches(db: any, ops: Array<(b: any) => void>) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + 400)) op(batch)
    await batch.commit()
  }
}

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

/** Re-point a uid field on every doc that holds the source; returns how many moved. */
async function repoint(db: any, collection: string, fields: string[], src: string, tgt: string, nowIso: string) {
  const docs = await docsMatching(db, collection, fields.map((f) => [f, src] as [string, unknown]))
  await inBatches(
    db,
    docs.map((d) => (b: any) => {
      const data = d.data() || {}
      const patch: Record<string, unknown> = { merged_from_uid: src, merged_at: nowIso }
      for (const f of fields) if (data[f] === src) patch[f] = tgt
      b.set(d.ref, patch, { merge: true })
    })
  )
  return docs.length
}

/**
 * Re-point docs that are UNIQUE per (owner, key): drop the source's copy when
 * the target already has one for the same key (a favorite of the same event,
 * a follow of the same organizer), otherwise re-point it.
 */
async function repointUnique(
  db: any,
  collection: string,
  ownerField: string,
  keyField: string,
  src: string,
  tgt: string,
  nowIso: string
) {
  const [mine, theirs] = await Promise.all([
    db.collection(collection).where(ownerField, '==', src).get(),
    db.collection(collection).where(ownerField, '==', tgt).get(),
  ])
  const have = new Set(theirs.docs.map((d: any) => (d.data() || {})[keyField]))
  let moved = 0
  let dropped = 0
  await inBatches(
    db,
    mine.docs.map((d: any) => (b: any) => {
      const key = (d.data() || {})[keyField]
      if (key != null && have.has(key)) {
        dropped++
        b.delete(d.ref)
      } else {
        moved++
        if (key != null) have.add(key)
        b.set(d.ref, { [ownerField]: tgt, merged_from_uid: src, merged_at: nowIso }, { merge: true })
      }
    })
  )
  return moved + dropped
}

/** Copy a users/{uid} subcollection to the target (target's own docs win). */
async function copyUserSub(db: any, sub: string, src: string, tgt: string) {
  const from = db.collection('users').doc(src).collection(sub)
  const to = db.collection('users').doc(tgt).collection(sub)
  const snap = await from.get()
  const ops: Array<(b: any) => void> = []
  for (const d of snap.docs) {
    const dest = to.doc(d.id)
    const existing = await dest.get()
    if (!existing.exists) ops.push((b) => b.set(dest, d.data() || {}))
    ops.push((b) => b.delete(d.ref))
  }
  await inBatches(db, ops)
  return snap.docs.length
}

const ROLE_RANK: Record<string, number> = { staff: 1, manager: 2, admin: 3, owner: 4 }

/** Org TEAM memberships (not ownership): the target takes the source's seat. */
async function moveTeamMemberships(db: any, src: string, tgt: string, nowIso: string) {
  const memberships = await db.collection('users').doc(src).collection('org_memberships').get()
  let moved = 0
  for (const m of memberships.docs) {
    const orgId = m.id
    const orgTeam = db.collection('organizers').doc(orgId).collection('team')
    const [srcSeat, tgtSeat] = await Promise.all([orgTeam.doc(src).get(), orgTeam.doc(tgt).get()])
    const ops: Array<(b: any) => void> = []
    if (orgId !== tgt) {
      // The target owns this org: it needs no seat on it.
      const seat = srcSeat.exists ? srcSeat.data() || {} : null
      const keep = tgtSeat.exists ? tgtSeat.data() || {} : null
      if (seat && (!keep || (ROLE_RANK[seat.role] || 0) > (ROLE_RANK[keep.role] || 0))) {
        ops.push((b) => b.set(orgTeam.doc(tgt), { ...seat, uid: tgt, merged_from_uid: src, merged_at: nowIso }))
      }
      const mirror = m.data() || {}
      const tgtMirror = db.collection('users').doc(tgt).collection('org_memberships').doc(orgId)
      const keepMirror = await tgtMirror.get()
      if (!keepMirror.exists || (seat && (!keep || (ROLE_RANK[seat.role] || 0) > (ROLE_RANK[keep.role] || 0)))) {
        ops.push((b) => b.set(tgtMirror, { ...mirror, merged_from_uid: src }))
      }
    }
    if (srcSeat.exists) ops.push((b) => b.delete(srcSeat.ref))
    ops.push((b) => b.delete(m.ref))
    await inBatches(db, ops)
    moved++
  }
  return moved
}

/** Door-staff seats: events/{id}/members/{uid} (doc id IS the uid). */
async function moveEventStaff(db: any, src: string, tgt: string) {
  let snap: any
  try {
    snap = await db.collectionGroup('members').where('uid', '==', src).get()
  } catch (err: any) {
    console.warn('[account-merge] staff sweep skipped', err?.message)
    return 0
  }
  const ops: Array<(b: any) => void> = []
  for (const d of snap.docs) {
    const parent = d.ref.parent
    const dest = parent.doc(tgt)
    const existing = await dest.get()
    if (!existing.exists) ops.push((b) => b.set(dest, { ...(d.data() || {}), uid: tgt, merged_from_uid: src }))
    ops.push((b) => b.delete(d.ref))
  }
  await inBatches(db, ops)
  return snap.docs.length
}

/** Friendships: one doc per pair, id = sorted uids. */
async function moveConnections(db: any, src: string, tgt: string, nowIso: string) {
  const snap = await db.collection('connections').where('users', 'array-contains', src).get()
  const ops: Array<(b: any) => void> = []
  for (const d of snap.docs) {
    const c = d.data() || {}
    const other = (c.users || []).find((u: string) => u !== src)
    ops.push((b) => b.delete(d.ref))
    if (!other || other === tgt) continue // they were friends with themselves
    const dest = db.collection('connections').doc(connectionIdFor(tgt, other))
    const existing = await dest.get()
    if (existing.exists) continue // already friends on the target
    const swap = (u: unknown) => (u === src ? tgt : u)
    ops.push((b) =>
      b.set(dest, {
        ...c,
        users: [tgt, other].sort(),
        requester_id: swap(c.requester_id),
        recipient_id: swap(c.recipient_id),
        merged_from_uid: src,
        updated_at: nowIso,
      })
    )
  }
  await inBatches(db, ops)
  return snap.docs.length
}

const PROFILE_FILL = ['full_name', 'first_name', 'last_name', 'photo_url', 'bio', 'default_city', 'default_country', 'default_subarea', 'language']

/** Fill what the target's profile is missing from the source's. */
async function fillProfile(db: any, src: string, tgt: string, movedPhone: string | null, nowIso: string) {
  const [s, t] = await Promise.all([db.collection('users').doc(src).get(), db.collection('users').doc(tgt).get()])
  const source = s.exists ? s.data() || {} : {}
  const target = t.exists ? t.data() || {} : {}
  const patch: Record<string, unknown> = {}
  for (const f of PROFILE_FILL) if (blank(target[f]) && !blank(source[f])) patch[f] = source[f]
  if (movedPhone) {
    patch.phone = movedPhone
    patch.phone_number = movedPhone
    patch.phone_verified = true
  }
  patch.merged_accounts = Array.from(new Set([...(Array.isArray(target.merged_accounts) ? target.merged_accounts : []), src]))
  patch.updated_at = nowIso
  await db.collection('users').doc(tgt).set(patch, { merge: true })
  const pub = pickPublicProfileFields(patch)
  if (Object.keys(pub).length) await db.collection('public_profiles').doc(tgt).set(pub, { merge: true })
  return Object.keys(patch).filter((k) => !['merged_accounts', 'updated_at'].includes(k)).length
}

// ── The merge ───────────────────────────────────────────────────────────────

/** Move the person-level data. Every step is safe to repeat. */
export async function moveAccountData(db: any, src: string, tgt: string, nowIso: string) {
  const counts: Record<string, number> = {}
  // Tickets first: they are the one thing that must never be lost.
  counts.tickets = await repoint(db, 'tickets', ['user_id', 'attendee_id', 'buyer_id', 'original_owner_id'], src, tgt, nowIso)
  counts.orders =
    (await repoint(db, 'pending_transactions', ['user_id'], src, tgt, nowIso)) +
    (await repoint(db, 'guest_orders', ['claimed_by_uid'], src, tgt, nowIso))
  counts.transfers = await repoint(db, 'ticket_transfers', ['from_user_id', 'to_user_id'], src, tgt, nowIso)
  counts.favorites =
    (await repointUnique(db, 'favorites', 'user_id', 'event_id', src, tgt, nowIso)) +
    (await repointUnique(db, 'event_favorites', 'user_id', 'event_id', src, tgt, nowIso))
  counts.follows =
    (await repointUnique(db, 'organizer_follows', 'follower_id', 'organizer_id', src, tgt, nowIso)) +
    (await repointUnique(db, 'organizer_followers', 'follower_id', 'organizer_id', src, tgt, nowIso))
  counts.connections = await moveConnections(db, src, tgt, nowIso)
  counts.reviews = await repoint(db, 'reviews', ['user_id'], src, tgt, nowIso)
  counts.push_subscriptions = await repoint(db, 'pushSubscriptions', ['userId'], src, tgt, nowIso)
  counts.promoter_links = await repoint(db, 'event_promoters', ['claimed_by_uid'], src, tgt, nowIso)
  counts.community =
    (await repoint(db, 'event_submissions', ['submitted_by'], src, tgt, nowIso)) +
    (await repoint(db, 'event_claims', ['requested_by'], src, tgt, nowIso))
  counts.team_memberships = await moveTeamMemberships(db, src, tgt, nowIso)
  counts.event_staff = await moveEventStaff(db, src, tgt)
  counts.push_tokens = await copyUserSub(db, 'fcmTokens', src, tgt)
  counts.notifications = await copyUserSub(db, 'notifications', src, tgt)
  counts.blocks = (await copyUserSub(db, 'blocked_organizers', src, tgt)) + (await copyUserSub(db, 'invite_mutes', src, tgt))
  return counts
}

/** Take (or refuse) the lease on account_merges/{id}. */
async function acquire(db: any, id: string, req: MergeRequest, nowMs: number) {
  const ref = db.collection(MERGES).doc(id)
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const cur = snap.exists ? snap.data() || {} : {}
    if (cur.status === 'completed') return { state: 'completed' as const, doc: cur }
    if (cur.status === 'in_progress' && Number(cur.lease_until) > nowMs) return { state: 'busy' as const, doc: cur }
    tx.set(
      ref,
      {
        status: 'in_progress',
        source_uid: req.sourceUid,
        target_uid: req.targetUid,
        reason: req.reason,
        proofs: req.proofs,
        requested_by: req.requestedBy,
        started_at: cur.started_at ?? new Date(nowMs).toISOString(),
        attempts: (Number(cur.attempts) || 0) + 1,
        lease_until: nowMs + LEASE_MS,
      },
      { merge: true }
    )
    return { state: 'acquired' as const, doc: cur }
  })
}

export async function runAccountMerge(db: any, auth: MergeAuthAdmin, req: MergeRequest): Promise<MergeOutcome> {
  const now = req.now ?? new Date()
  const nowIso = now.toISOString()
  const id = mergeIdFor(req.sourceUid, req.targetUid)
  const ref = db.collection(MERGES).doc(id)

  // A finished merge answers the same way on every retry, before any check
  // (the source is disabled and its phone moved by then).
  const done = await ref.get()
  if (done.exists && (done.data() || {}).status === 'completed') {
    const d = done.data() || {}
    return { status: 'completed', mergeId: id, counts: d.counts || {}, movedPhone: null, alreadyDone: true }
  }

  const assessed = await assessMerge(db, auth, req.sourceUid, req.targetUid, {
    requireVerifiedTargetEmail: req.reason === 'phone_account_added_email',
  })
  if (!assessed.ok && assessed.kind === 'blocked') return { status: 'blocked', mergeId: id, code: assessed.code }
  if (!assessed.ok) {
    const reviewId = await openMergeReview(db, {
      sourceUid: req.sourceUid,
      targetUid: req.targetUid,
      reasons: assessed.reasons,
      source: assessed.source,
      target: assessed.target,
      reason: req.reason,
      nowIso,
    })
    await ref.set(
      { status: 'needs_review', source_uid: req.sourceUid, target_uid: req.targetUid, reason: req.reason, review_id: reviewId, updated_at: nowIso },
      { merge: true }
    )
    return { status: 'needs_review', mergeId: id, reviewId, reasons: assessed.reasons }
  }

  const lease = await acquire(db, id, req, now.getTime())
  if (lease.state === 'busy') return { status: 'busy', mergeId: id }
  if (lease.state === 'completed') {
    return { status: 'completed', mergeId: id, counts: lease.doc.counts || {}, movedPhone: null, alreadyDone: true }
  }

  const src = req.sourceUid
  const tgt = req.targetUid
  const counts = await moveAccountData(db, src, tgt, nowIso)
  const movedPhone = assessed.movePhone
  counts.profile_fields = await fillProfile(db, src, tgt, movedPhone, nowIso)

  // Auth LAST. The number leaves the source before it lands on the target
  // (Firebase refuses a number held by another account).
  if (movedPhone) {
    const current = await auth.getUser(tgt)
    if (current.phoneNumber !== movedPhone) {
      await auth.updateUser(src, { phoneNumber: null })
      await auth.updateUser(tgt, { phoneNumber: movedPhone })
    }
  }
  try {
    await auth.revokeRefreshTokens(src)
    await auth.updateUser(src, { disabled: true })
  } catch (err) {
    if (!isCode(err, 'auth/user-not-found')) throw err
  }
  await db.collection('users').doc(src).set(
    { account_status: 'merged', merged_into: tgt, merged_at: nowIso, phone: null, phone_number: null, phone_verified: false },
    { merge: true }
  )

  await ref.set(
    { status: 'completed', completed_at: new Date().toISOString(), counts, phone_moved: Boolean(movedPhone), lease_until: 0 },
    { merge: true }
  )
  return { status: 'completed', mergeId: id, counts, movedPhone }
}
