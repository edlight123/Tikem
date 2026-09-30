/**
 * Account deletion — the ONE implementation (App Store 5.1.1(v), Google Play
 * account-deletion policy, GDPR Art. 17).
 *
 * Called by POST /api/account/delete (mobile + web), and by the legacy
 * DELETE /api/gdpr/data and POST /api/organizer/settings/danger-zone/delete,
 * which both delegate here. Before this existed the GDPR route ran against the
 * Supabase-style shim and never deleted the Firebase Auth user (so the person
 * could still sign in), and the organizer danger-zone route deleted every one of
 * the organizer's EVENTS — orphaning buyers' tickets and money.
 *
 * Semantics:
 *  - DELETED: the Auth user (refresh tokens revoked first), users/{uid} and all
 *    its subcollections (push tokens, in-app notifications, preferences), the
 *    public profile projection, favorites / follows / reviews, web-push
 *    subscriptions, event-staff memberships, verification requests, the
 *    organizer's payout profiles / payout config / payout destinations (the
 *    encrypted bank + MonCash details), verification documents, login history,
 *    and uploaded profile / verification images in Storage.
 *  - ANONYMIZED (kept, PII stripped): tickets (the event's attendance and money
 *    ledger), orders (pending_transactions, guest_orders — legal retention),
 *    withdrawal requests (accounting; destination masked to the last 4), ticket
 *    transfers, promoter links, the organizers/{uid} doc (past events still
 *    point at it) and its payout history.
 *  - REFUSED (409 organizer_has_active_obligations) while the account still
 *    has buyers or money attached: an upcoming, non-cancelled event with sold
 *    tickets; unwithdrawn organizer earnings; a withdrawal still pending or
 *    processing; or a promoter-wallet balance. Nothing is ever silently
 *    orphaned — the user resolves each item first.
 *
 * Order matters: obligations are checked first, data is scrubbed next, and the
 * Auth user is deleted LAST, so a failure mid-way leaves a signed-in user who
 * can simply retry (every step is idempotent). The audit record
 * `account_deletions/{uid}` holds timestamps and counts only — no PII.
 */

import { adminAuth, adminDb, adminStorage } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/** How recent the sign-in must be for a deletion to go through. */
export const REAUTH_MAX_AGE_SECONDS = 10 * 60

export const DELETED_USER_LABEL = 'Deleted user'

// ── Auth ────────────────────────────────────────────────────────────────────

export type DeletionAuthResult =
  | { ok: true; uid: string; email: string | null; authTimeSec: number }
  | { ok: false; status: number; code: 'unauthorized' | 'reauth_required' }
  | { ok: false; status: 200; code: 'already_deleted'; uid: string }

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=') || null
  }
  return null
}

function bearerFrom(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const t = authHeader.slice('Bearer '.length).trim()
    if (t) return t
  }
  const alt = request.headers.get('x-firebase-token')
  return alt ? alt.trim() || null : null
}

/**
 * Resolve the caller and enforce a RECENT sign-in.
 *
 * A Bearer ID token is preferred over the session cookie: the mobile app sends
 * both, and after a re-authentication only the freshly minted ID token carries
 * the new `auth_time` (a web session cookie keeps the auth_time of the sign-in
 * that created it, up to five days ago).
 *
 * A token for a user that no longer exists is answered with `already_deleted`
 * when our own audit record says the deletion completed — that is what makes a
 * repeated request (a retry after a dropped response) succeed instead of 401.
 */
export async function resolveDeletionAuth(request: Request, nowMs = Date.now()): Promise<DeletionAuthResult> {
  const bearer = bearerFrom(request)
  const cookie = bearer ? null : readCookie(request.headers.get('cookie'), 'session')
  if (!bearer && !cookie) return { ok: false, status: 401, code: 'unauthorized' }

  const verify = (checkRevoked: boolean) =>
    bearer ? adminAuth.verifyIdToken(bearer, checkRevoked) : adminAuth.verifySessionCookie(cookie, checkRevoked)

  let decoded: any
  try {
    decoded = await verify(true)
  } catch (err: any) {
    const code = String(err?.code || '')
    const goneOrRevoked =
      code === 'auth/user-not-found' ||
      code === 'auth/id-token-revoked' ||
      code === 'auth/session-cookie-revoked' ||
      code === 'auth/user-disabled'
    if (goneOrRevoked) {
      try {
        const unchecked = await verify(false)
        const uid = String(unchecked?.uid || '')
        if (uid) {
          const audit = await adminDb.collection('account_deletions').doc(uid).get()
          if (audit.exists && (audit.data() as any)?.status === 'completed') {
            return { ok: false, status: 200, code: 'already_deleted', uid }
          }
        }
      } catch {
        // fall through to unauthorized
      }
    }
    return { ok: false, status: 401, code: 'unauthorized' }
  }

  const uid = String(decoded?.uid || '')
  if (!uid) return { ok: false, status: 401, code: 'unauthorized' }

  const authTimeSec = Number(decoded?.auth_time || 0)
  if (!authTimeSec || nowMs / 1000 - authTimeSec > REAUTH_MAX_AGE_SECONDS) {
    return { ok: false, status: 401, code: 'reauth_required' }
  }

  return { ok: true, uid, email: decoded?.email ? String(decoded.email) : null, authTimeSec }
}

// ── Obligations ─────────────────────────────────────────────────────────────

export type Obligation =
  | { type: 'upcoming_events_with_sales'; events: Array<{ id: string; title: string; ticketsSold: number }> }
  | { type: 'unwithdrawn_balance'; balances: Array<{ currency: string; amountMinor: number }> }
  | { type: 'withdrawals_in_flight'; count: number }
  | { type: 'promoter_wallet_balance'; balances: Array<{ currency: string; amountMinor: number }> }

function toMillis(value: any): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (typeof value?._seconds === 'number') return value._seconds * 1000
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : null
}

const minor = (v: unknown) => {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function addTo(map: Map<string, number>, currency: unknown, amount: number) {
  const c = String(currency || 'HTG').toUpperCase()
  map.set(c, (map.get(c) || 0) + amount)
}

function positiveBalances(map: Map<string, number>) {
  return Array.from(map.entries())
    .filter(([, v]) => v > 0)
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
}

const NON_RELEASING = new Set(['failed', 'canceled', 'cancelled'])
const IN_FLIGHT = new Set(['pending', 'processing', 'reserved', 'under_review', 'in_review'])

async function countLiveTickets(eventId: string): Promise<number> {
  const snap = await adminDb.collection('tickets').where('event_id', '==', eventId).get()
  return snap.docs.filter((d: any) => isLiveTicketStatus(d.data()?.status)).length
}

/**
 * Everything that must be resolved before this account can go. Empty = clear.
 * Reads only equality queries and filters in memory, so it needs no composite
 * index and sees tickets written under any status spelling.
 */
export async function findActiveObligations(uid: string, nowMs = Date.now()): Promise<Obligation[]> {
  const obligations: Obligation[] = []

  // 1. Upcoming events that buyers hold tickets for.
  const eventsSnap = await adminDb.collection('events').where('organizer_id', '==', uid).get()
  const upcoming: Array<{ id: string; title: string; ticketsSold: number }> = []
  for (const doc of eventsSnap.docs) {
    const e = doc.data() || {}
    if (String(e.status || '').toLowerCase() === 'cancelled') continue
    const endsAt = toMillis(e.end_datetime) ?? toMillis(e.start_datetime)
    // An event with no parseable date is treated as upcoming: better to ask the
    // organizer than to strand its buyers.
    if (endsAt != null && endsAt < nowMs) continue
    const live = await countLiveTickets(doc.id)
    const sold = Math.max(live, 0)
    if (sold > 0) upcoming.push({ id: doc.id, title: String(e.title || 'Event'), ticketsSold: sold })
  }
  if (upcoming.length) obligations.push({ type: 'upcoming_events_with_sales', events: upcoming })

  // 2. Organizer money not yet paid out (withdrawn manually or released by Stripe).
  const earningsSnap = await adminDb.collection('event_earnings').where('organizerId', '==', uid).get()
  const owed = new Map<string, number>()
  for (const doc of earningsSnap.docs) {
    const e = doc.data() || {}
    if (String(e.settlementStatus || '').toLowerCase() === 'cancelled') continue
    const eventId = String(e.eventId || doc.id)
    const releasesSnap = await adminDb.collection('payout_releases').where('eventId', '==', eventId).get()
    const released = releasesSnap.docs.reduce((sum: number, r: any) => {
      const d = r.data() || {}
      return NON_RELEASING.has(String(d.status || '').toLowerCase()) ? sum : sum + Math.max(0, minor(d.amountMinor))
    }, 0)
    const remaining = Math.max(
      Math.max(0, minor(e.availableToWithdraw)),
      minor(e.netAmount) - Math.max(0, minor(e.withdrawnAmount)) - released
    )
    if (remaining > 0) addTo(owed, e.currency, remaining)
  }
  const owedList = positiveBalances(owed)
  if (owedList.length) obligations.push({ type: 'unwithdrawn_balance', balances: owedList })

  // 3. Withdrawals still moving (organizer or promoter).
  const [orgWithdrawals, promoterWithdrawals] = await Promise.all([
    adminDb.collection('withdrawal_requests').where('organizerId', '==', uid).get(),
    adminDb.collection('withdrawal_requests').where('promoter_uid', '==', uid).get(),
  ])
  const inFlightIds = new Set<string>()
  for (const doc of [...orgWithdrawals.docs, ...promoterWithdrawals.docs]) {
    if (IN_FLIGHT.has(String(doc.data()?.status || '').toLowerCase())) inFlightIds.add(doc.id)
  }
  if (inFlightIds.size) obligations.push({ type: 'withdrawals_in_flight', count: inFlightIds.size })

  // 4. Promoter commission earned but not withdrawn (held OR released — both
  //    are the promoter's money). Same sources as lib/promoter-wallet.ts.
  const promotersSnap = await adminDb.collection('event_promoters').where('claimed_by_uid', '==', uid).get()
  if (!promotersSnap.empty) {
    const accrued = new Map<string, number>()
    for (const p of promotersSnap.docs) {
      const salesSnap = await adminDb.collection('promoter_sales').where('promoter_id', '==', p.id).get()
      for (const s of salesSnap.docs) {
        const d = s.data() || {}
        if (d.funded !== true || d.status !== 'accrued') continue
        addTo(accrued, d.currency, Math.max(0, minor(d.commission_cents)))
      }
    }
    const walletSnap = await adminDb.collection('promoter_wallets').doc(uid).get()
    const withdrawn = (walletSnap.exists ? (walletSnap.data() as any)?.withdrawn_by_currency : null) || {}
    for (const [currency, amount] of Object.entries(withdrawn)) addTo(accrued, currency, -minor(amount))
    const walletList = positiveBalances(accrued)
    if (walletList.length) obligations.push({ type: 'promoter_wallet_balance', balances: walletList })
  }

  return obligations
}

// ── Scrubbing ───────────────────────────────────────────────────────────────

const TICKET_PII = [
  'attendee_email', 'attendee_phone', 'attendeeEmail', 'attendeeName', 'attendeePhone',
  'guest_email', 'guest_phone', 'guest_name',
  'user_name', 'user_email', 'buyer_name', 'buyer_email', 'buyer_phone',
  'purchaser_name', 'purchaser_email', 'holder_name', 'holder_email',
]
const ORDER_PII = [
  ...TICKET_PII, 'name', 'email', 'phone', 'customer_email', 'customer_name', 'customer_phone',
  'payer_phone', 'ip_address',
]
const TRANSFER_PII = ['from_email', 'from_name', 'to_email', 'to_name', 'to_phone', 'from_phone', 'recipient_email', 'recipient_name']
const PROMOTER_PII = ['claimed_by_email', 'claimed_by_name', 'email', 'phone', 'name']

function scrubPatch(data: Record<string, any>, fields: string[], nowIso: string) {
  const patch: Record<string, any> = { account_deleted: true, anonymized_at: nowIso }
  for (const f of fields) if (f in data && data[f] != null) patch[f] = null
  if ('attendee_name' in data) patch.attendee_name = DELETED_USER_LABEL
  return patch
}

const maskTail = (v: unknown) => {
  const s = String(v ?? '').replace(/\s+/g, '')
  return s ? `••••${s.slice(-4)}` : null
}

/** Unique docs across several equality queries on one collection. */
async function docsMatching(collection: string, clauses: Array<[string, unknown]>) {
  const seen = new Map<string, any>()
  for (const [field, value] of clauses) {
    if (value == null || value === '') continue
    const snap = await adminDb.collection(collection).where(field, '==', value).get()
    for (const d of snap.docs) seen.set(d.id, d)
  }
  return Array.from(seen.values())
}

async function inChunks<T>(items: T[], fn: (item: T) => Promise<unknown>, size = 50) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

async function deleteAll(docs: any[]) {
  await inChunks(docs, (d) => d.ref.delete())
  return docs.length
}

export type DeletionCounts = Record<string, number>

const ORGANIZER_PRIVATE_SUBCOLLECTIONS = [
  'payoutProfiles', 'payoutConfig', 'payoutDestinations', 'verificationDocuments',
  'security', 'loginHistory', 'notificationPreferences', 'tasks', 'team',
]

/**
 * Delete / anonymize everything for `uid`. Assumes obligations were checked.
 * Every step is safe to repeat.
 */
export async function scrubAccountData(uid: string, email: string | null, nowIso = new Date().toISOString()) {
  const counts: DeletionCounts = {}
  const emails = Array.from(new Set([email, email?.toLowerCase()].filter(Boolean))) as string[]
  const byEmail = (field: string) => emails.map((e) => [field, e] as [string, unknown])

  // Tickets — keep for attendance + ledger, strip identity.
  const tickets = await docsMatching('tickets', [
    ['attendee_id', uid], ['user_id', uid], ...byEmail('attendee_email'), ...byEmail('guest_email'),
  ])
  await inChunks(tickets, (d) => d.ref.set(scrubPatch(d.data() || {}, TICKET_PII, nowIso), { merge: true }))
  counts.tickets_anonymized = tickets.length

  // Orders — legal retention, strip identity.
  const orders = await docsMatching('pending_transactions', [['user_id', uid], ...byEmail('guest_email')])
  await inChunks(orders, (d) => d.ref.set(scrubPatch(d.data() || {}, ORDER_PII, nowIso), { merge: true }))
  const guestOrders = await docsMatching('guest_orders', [['claimed_by_uid', uid], ...byEmail('email')])
  await inChunks(guestOrders, (d) => d.ref.set(scrubPatch(d.data() || {}, ORDER_PII, nowIso), { merge: true }))
  counts.orders_anonymized = orders.length + guestOrders.length

  // Withdrawals — accounting record; destination masked, holder name dropped.
  const withdrawals = await docsMatching('withdrawal_requests', [['organizerId', uid], ['promoter_uid', uid]])
  await inChunks(withdrawals, (d) => {
    const w = d.data() || {}
    const patch: Record<string, any> = { account_deleted: true, anonymized_at: nowIso }
    if (w.moncashNumber) patch.moncashNumber = maskTail(w.moncashNumber)
    if (w.moncash_phone) patch.moncash_phone = maskTail(w.moncash_phone)
    if (w.phone) patch.phone = maskTail(w.phone)
    if (w.bankDetails && typeof w.bankDetails === 'object') {
      patch.bankDetails = {
        bankName: w.bankDetails.bankName ?? null,
        accountNumber: maskTail(w.bankDetails.accountNumber),
        accountHolder: null,
        swiftCode: null,
        routingNumber: null,
      }
    }
    for (const f of ['organizerName', 'organizerEmail', 'payee_name', 'payee_email', 'accountHolder']) {
      if (w[f] != null) patch[f] = null
    }
    // bankDetails is REPLACED, not merged, so the full account number goes.
    return d.ref.update(patch)
  })
  counts.withdrawals_anonymized = withdrawals.length

  // Transfers.
  const transfers = await docsMatching('ticket_transfers', [
    ['from_user_id', uid], ['to_user_id', uid], ...byEmail('to_email'),
  ])
  await inChunks(transfers, (d) => d.ref.set(scrubPatch(d.data() || {}, TRANSFER_PII, nowIso), { merge: true }))
  counts.transfers_anonymized = transfers.length

  // Promoter links belong to the organizer's event; unlink this account.
  const promoterLinks = await docsMatching('event_promoters', [['claimed_by_uid', uid]])
  await inChunks(promoterLinks, (d) =>
    d.ref.set({ ...scrubPatch(d.data() || {}, PROMOTER_PII, nowIso), claimed_by_uid: null }, { merge: true })
  )
  counts.promoter_links_unlinked = promoterLinks.length
  const wallet = adminDb.collection('promoter_wallets').doc(uid)
  if ((await wallet.get()).exists) {
    await wallet.set({ moncash_phone: null, account_deleted: true, anonymized_at: nowIso }, { merge: true })
  }

  // The account's own content and social graph — deleted outright.
  counts.favorites_deleted =
    (await deleteAll(await docsMatching('favorites', [['user_id', uid]]))) +
    (await deleteAll(await docsMatching('event_favorites', [['user_id', uid]])))
  counts.follows_deleted =
    (await deleteAll(await docsMatching('organizer_follows', [['follower_id', uid], ['organizer_id', uid]]))) +
    (await deleteAll(await docsMatching('organizer_followers', [['follower_id', uid], ['organizer_id', uid]])))
  counts.reviews_deleted = await deleteAll(await docsMatching('reviews', [['user_id', uid]]))
  counts.push_subscriptions_deleted = await deleteAll(await docsMatching('pushSubscriptions', [['userId', uid]]))
  try {
    const memberships = await adminDb.collectionGroup('members').where('uid', '==', uid).get()
    counts.staff_memberships_deleted = await deleteAll(memberships.docs)
  } catch (err: any) {
    console.warn('[account-delete] staff membership sweep skipped', { message: err?.message })
    counts.staff_memberships_deleted = 0
  }

  // Organizer side: upcoming events that sold nothing come down (the
  // obligation check already refused any that sold tickets); past events stay
  // for their attendees' history.
  const events = await adminDb.collection('events').where('organizer_id', '==', uid).get()
  const nowMs = Date.parse(nowIso)
  const toClose = events.docs.filter((d: any) => {
    const e = d.data() || {}
    if (String(e.status || '').toLowerCase() === 'cancelled') return false
    const endsAt = toMillis(e.end_datetime) ?? toMillis(e.start_datetime)
    return endsAt == null || endsAt >= nowMs
  })
  await inChunks(toClose, (d: any) =>
    d.ref.set(
      {
        status: 'cancelled',
        is_published: false,
        cancelled_at: nowIso,
        cancellation_reason: 'organizer_account_deleted',
        payouts_frozen: true,
        updated_at: nowIso,
      },
      { merge: true }
    )
  )
  counts.upcoming_events_closed = toClose.length

  const organizerRef = adminDb.collection('organizers').doc(uid)
  const organizerSnap = await organizerRef.get()
  for (const sub of ORGANIZER_PRIVATE_SUBCOLLECTIONS) {
    await adminDb.recursiveDelete(organizerRef.collection(sub))
  }
  if (organizerSnap.exists) {
    // Replaced (not merged): business name, contact details and any legacy
    // inline payout fields all go. organizers/{uid}/payouts (accounting) stays.
    await organizerRef.set({ account_deleted: true, deleted_at: nowIso, display_name: DELETED_USER_LABEL })
  }
  counts.was_organizer = organizerSnap.exists || events.size > 0 ? 1 : 0

  for (const [collection, id] of [
    ['public_profiles', uid],
    ['verification_requests', uid],
    ['organizer_activation', uid],
  ] as const) {
    await adminDb.collection(collection).doc(id).delete()
  }

  // users/{uid} and every subcollection (fcmTokens, notifications, prefs…).
  await adminDb.recursiveDelete(adminDb.collection('users').doc(uid))

  // Storage — best-effort; a missing bucket must not block the deletion.
  let storageFiles = 0
  try {
    const bucket = adminStorage.bucket()
    for (const prefix of [`profile-images/${uid}/`, `verification/${uid}/`]) {
      const [files] = await bucket.getFiles({ prefix })
      storageFiles += files.length
      if (files.length) await bucket.deleteFiles({ prefix, force: true })
    }
  } catch (err: any) {
    console.warn('[account-delete] storage sweep skipped', { message: err?.message })
  }
  counts.storage_files_deleted = storageFiles

  return counts
}

// ── Orchestration ───────────────────────────────────────────────────────────

export type DeleteAccountOutcome =
  | { status: 'deleted'; counts: DeletionCounts }
  | { status: 'refused'; obligations: Obligation[] }

export async function deleteAccount(uid: string, email: string | null, now = new Date()): Promise<DeleteAccountOutcome> {
  const obligations = await findActiveObligations(uid, now.getTime())
  if (obligations.length) return { status: 'refused', obligations }

  const nowIso = now.toISOString()
  const auditRef = adminDb.collection('account_deletions').doc(uid)
  await auditRef.set({ status: 'in_progress', requested_at: nowIso }, { merge: true })

  const counts = await scrubAccountData(uid, email, nowIso)

  try {
    await adminAuth.revokeRefreshTokens(uid)
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found') throw err
  }
  try {
    await adminAuth.deleteUser(uid)
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found') throw err
  }

  await auditRef.set({ status: 'completed', completed_at: new Date().toISOString(), counts }, { merge: true })
  return { status: 'deleted', counts }
}

/**
 * The full HTTP exchange, shared by every route that deletes an account.
 *
 *  200 { deleted: true }                                     — done (or already done)
 *  401 { code: 'unauthorized' | 'reauth_required' }
 *  409 { code: 'organizer_has_active_obligations', obligations: [...] }
 *  500 { code: 'deletion_failed' }                           — safe to retry
 */
export async function handleAccountDeletionRequest(request: Request): Promise<Response> {
  const auth = await resolveDeletionAuth(request)
  if (!auth.ok) {
    if (auth.code === 'already_deleted') {
      return Response.json({ deleted: true, alreadyDeleted: true })
    }
    return Response.json(
      {
        code: auth.code,
        error:
          auth.code === 'reauth_required'
            ? 'Please sign in again to confirm it is you, then retry.'
            : 'Unauthorized',
      },
      { status: auth.status }
    )
  }

  try {
    const outcome = await deleteAccount(auth.uid, auth.email)
    if (outcome.status === 'refused') {
      return Response.json(
        {
          code: 'organizer_has_active_obligations',
          error: 'This account still has buyers or money attached. Resolve the listed items, then try again.',
          obligations: outcome.obligations,
        },
        { status: 409 }
      )
    }
    return Response.json({ deleted: true, counts: outcome.counts })
  } catch (err: any) {
    console.error('[account-delete] failed', { uid: auth.uid, message: err?.message })
    return Response.json(
      { code: 'deletion_failed', error: 'Account deletion failed part-way. Please try again.' },
      { status: 500 }
    )
  }
}
