/**
 * Paying for a door team, upfront, on Tikèm's own rails (lib/platformPay,
 * shared with printed tickets):
 *   - MonCash Button: door_team_orders/{orderId} → the request, confirmed on
 *     /api/moncash-button/return with RetrieveOrderPayment + the amount check.
 *   - Card: Stripe Checkout on the PLATFORM account, HTG → USD with the guarded
 *     FX engine ('lowest' fallback), the expected USD stamped on each session.
 *   - Balance: one event's released HTG covering the full price, owner / finance
 *     admin only, through the withdrawal debit, row doorteam_{requestId}.
 *
 * Protections kept from printed tickets:
 *   - every confirmation ends in markRequestPaid (idempotent, late or second
 *     payments flagged needs_refund);
 *   - deterministic ids (MonCash order doc, offset row) so a retry never pays twice;
 *   - one live card session per request: a restart or a switch to MonCash /
 *     balance retires the earlier one FIRST, then expires it;
 *   - checkout.session.expired acts only on the request's CURRENT session;
 *   - each payment attempt opens a 2h window (never past the quote's close);
 *     the sweep asks the gateways once more before a quote is expired.
 */

import { adminDb } from '@/lib/firebase/admin'
import {
  cardAmountForHtg,
  cardSessionPaidInFull,
  createPlatformCheckout,
  expireOpenCheckoutSession,
  retrieveCheckoutSession,
} from '@/lib/platformPay/card'
import { checkMonCashOrder, monCashRedirectFor, newMonCashOrderId } from '@/lib/platformPay/moncash'
import { canUseBalance, debitReleasedBalance, isLiveOffsetRow, reverseOffsetRowInTransaction } from '@/lib/platformPay/balance'
import type { CurrentUser } from '@/lib/organizer/context'
import { completeRequest, getRequest, loadDoorTeamConfig, markRequestPaid, requestRef, revokeCrewAccess, type DoorTeamRequest } from './requests'
import { DOOR_TEAM_ORDERS, PAYMENT_WINDOW_MS, cancelDecision, doorTeamOffsetId, toDate } from './rules'
import { notifyAdmins } from './notify'

export const DOOR_TEAM_CARD_KIND = 'door_team'

export function requestPageUrl(origin: string, r: { id: string; event_id: string }, extra = ''): string {
  return `${origin}/organizer/events/${encodeURIComponent(r.event_id)}/door-team?request=${encodeURIComponent(r.id)}${extra}`
}

function payable(r: DoorTeamRequest | null): r is DoorTeamRequest {
  return !!r && r.status === 'quoted' && Number(r.price_htg) > 0
}

/** The current attempt's window: 2h, but never past the quote's close (unless the quote already closed). */
export function paymentWindowEnd(now: number, quoteExpiresAt: string | null | undefined): string {
  const cap = toDate(quoteExpiresAt)?.getTime()
  const end = now + PAYMENT_WINDOW_MS
  return new Date(cap && cap > now ? Math.min(end, cap) : end).toISOString()
}

/** Forget the current card session FIRST (so its expiry cannot match), then expire it. */
export async function retireDoorTeamCardSession(r: Pick<DoorTeamRequest, 'id' | 'payment'>): Promise<void> {
  const sessionId = String(r.payment?.stripe_session_id || '')
  if (!sessionId) return
  await requestRef(r.id).update({
    'payment.stripe_session_id': null,
    'payment.retired_stripe_session_id': sessionId,
    updated_at: new Date().toISOString(),
  })
  await expireOpenCheckoutSession(sessionId, { doorTeamRequestId: r.id })
}

// ── MonCash ──────────────────────────────────────────────────────────────────

export async function startMonCashDoorTeamPayment(r: DoorTeamRequest): Promise<{ redirectUrl: string; orderId: string }> {
  const orderId = newMonCashOrderId()
  await adminDb.collection(DOOR_TEAM_ORDERS).doc(orderId).set({
    request_id: r.id,
    event_id: r.event_id,
    amount_htg: Number(r.price_htg),
    created_at: new Date().toISOString(),
  })
  await retireDoorTeamCardSession(r)
  await requestRef(r.id).update({
    'payment.method': 'moncash',
    'payment.funds_rail': 'moncash',
    'payment.status': 'pending',
    'payment.order_id': orderId,
    payment_expires_at: paymentWindowEnd(Date.now(), r.quote_expires_at),
    updated_at: new Date().toISOString(),
  })
  return { redirectUrl: await monCashRedirectFor(Number(r.price_htg), orderId), orderId }
}

export async function findDoorTeamOrder(orderId: string): Promise<{ request_id: string; event_id: string; amount_htg: number } | null> {
  if (!orderId || orderId.includes('/')) return null
  const snap = await adminDb.collection(DOOR_TEAM_ORDERS).doc(orderId).get()
  return snap.exists ? (snap.data() as any) : null
}

export async function verifyMonCashDoorTeamPayment(orderId: string): Promise<{ paid: boolean; requestId: string | null; eventId: string | null; reason?: string }> {
  const order = await findDoorTeamOrder(orderId)
  if (!order) return { paid: false, requestId: null, eventId: null, reason: 'order_not_found' }
  const check = await checkMonCashOrder(orderId, Number(order.amount_htg), '[door-team]')
  if (!check.paid) return { paid: false, requestId: order.request_id, eventId: order.event_id, reason: check.reason }
  const res = await markRequestPaid(order.request_id, {
    funds_rail: 'moncash',
    reference: check.reference,
    amount: check.amount,
    currency: 'HTG',
    price_htg: Number(order.amount_htg),
    extra: { order_id: orderId, amount_verified: check.amountVerified },
  })
  if (res.ok && !res.alreadyPaid) await afterPaid(order.request_id)
  return { paid: res.ok, requestId: order.request_id, eventId: order.event_id, reason: res.code }
}

// ── card ─────────────────────────────────────────────────────────────────────

export async function startCardDoorTeamPayment(r: DoorTeamRequest, origin: string) {
  const price = Number(r.price_htg)
  const { amountUsdCents, htgPerUsd, rateSource } = await cardAmountForHtg(price)
  const previous = String(r.payment?.stripe_session_id || '')
  const session = await createPlatformCheckout({
    amountUsdCents,
    name: `Door team: ${r.staff_count} staff × ${r.hours}h`,
    description: r.event_title || null,
    statementNote: `Tikèm door team ${r.id}`,
    metadata: {
      kind: DOOR_TEAM_CARD_KIND,
      requestId: r.id,
      eventId: r.event_id,
      organizerId: r.organizer_id,
      expectedUsdCents: String(amountUsdCents),
      htgTotal: String(price),
      htgPerUsd: String(htgPerUsd),
    },
    successUrl: requestPageUrl(origin, r, '&card=return&session_id={CHECKOUT_SESSION_ID}'),
    cancelUrl: requestPageUrl(origin, r, '&card=cancelled'),
  })
  await requestRef(r.id).update({
    'payment.method': 'card',
    'payment.funds_rail': 'stripe_platform',
    'payment.status': 'pending',
    'payment.stripe_session_id': session.sessionId,
    'payment.amount_usd_cents': amountUsdCents,
    'payment.fx_htg_per_usd': htgPerUsd,
    'payment.fx_source': rateSource,
    'payment.session_expires_at': session.expiresAt,
    payment_expires_at: paymentWindowEnd(Date.now(), r.quote_expires_at),
    updated_at: new Date().toISOString(),
  })
  // The NEW id is saved first, so the old session's expiry no longer matches.
  if (previous && previous !== session.sessionId) await expireOpenCheckoutSession(previous, { doorTeamRequestId: r.id })
  return { redirectUrl: session.redirectUrl, sessionId: session.sessionId, amountUsdCents, rate: htgPerUsd, expiresAt: session.expiresAt }
}

export async function verifyCardDoorTeamPayment(sessionId: string, expectRequestId?: string | null): Promise<{ paid: boolean; requestId: string | null; reason?: string }> {
  const session = await retrieveCheckoutSession(String(sessionId))
  const requestId = String(session?.metadata?.requestId || '')
  if (session?.metadata?.kind !== DOOR_TEAM_CARD_KIND || !requestId) return { paid: false, requestId: null, reason: 'not_a_door_team_payment' }
  if (expectRequestId && expectRequestId !== requestId) return { paid: false, requestId, reason: 'request_mismatch' }
  if (session.payment_status !== 'paid') return { paid: false, requestId, reason: 'not_paid' }
  if (!cardSessionPaidInFull(session)) {
    console.error('[door-team] card amount below what the session asked for; NOT marked paid', { requestId, sessionId, paid: session.amount_total })
    return { paid: false, requestId, reason: 'amount_mismatch' }
  }
  const res = await markRequestPaid(requestId, {
    funds_rail: 'stripe_platform',
    reference: String(session.payment_intent || session.id),
    amount: Number(session.amount_total) / 100,
    currency: 'USD',
    price_htg: Number(session.metadata?.htgTotal),
    extra: { stripe_session_id: session.id },
  })
  if (res.ok && !res.alreadyPaid) await afterPaid(requestId)
  return { paid: res.ok, requestId, reason: res.code }
}

/** checkout.session.expired: only the request's CURRENT session clears the pending attempt. */
export async function handleDoorTeamCardSessionExpired(session: { id: string; metadata?: Record<string, any> | null }): Promise<boolean> {
  const requestId = String(session?.metadata?.requestId || '')
  if (session?.metadata?.kind !== DOOR_TEAM_CARD_KIND || !requestId) return false
  const r = await getRequest(requestId)
  if (!r || r.status !== 'quoted' || r.payment?.method !== 'card' || String(r.payment?.stripe_session_id || '') !== String(session.id)) return false
  await requestRef(requestId).update({
    'payment.status': 'expired',
    'payment.stripe_session_id': null,
    'payment.retired_stripe_session_id': session.id,
    updated_at: new Date().toISOString(),
  })
  return true
}

// ── balance ──────────────────────────────────────────────────────────────────

export type BalancePayResult = { ok: true; withdrawalId: string; alreadyDone?: boolean } | { ok: false; status: number; code: string; error: string }

export async function payDoorTeamFromBalance(params: { request: DoorTeamRequest; user: CurrentUser; retried?: boolean }): Promise<BalancePayResult> {
  const { request: r, user } = params
  if (!(await canUseBalance(user, r.organizer_id))) {
    return { ok: false, status: 403, code: 'balance_not_allowed', error: 'Only the owner or a finance admin can pay from the balance' }
  }
  const price = Number(r.price_htg)
  const rowRef = adminDb.collection('withdrawal_requests').doc(doorTeamOffsetId(r.id))
  const proof = (eventId: string) => ({
    funds_rail: 'balance_offset' as const,
    reference: rowRef.id,
    amount: price,
    currency: 'HTG',
    price_htg: price,
    extra: { offset_event_id: eventId, withdrawal_id: rowRef.id },
  })

  // A retry after the debit landed: finish, never debit again.
  const existing = await rowRef.get()
  if (existing.exists) {
    const row = existing.data() || {}
    if (isLiveOffsetRow(row) && row.doorTeamRequestId === r.id) {
      const paid = await markRequestPaid(r.id, proof(String(row.eventId)))
      if (!paid.ok) {
        await creditBackDoorTeamOffset(r.id, 'system')
        return { ok: false, status: 409, code: 'not_payable', error: 'This request can no longer be paid' }
      }
      if (!paid.alreadyPaid) await afterPaid(r.id)
      return { ok: true, withdrawalId: rowRef.id, alreadyDone: true }
    }
    return { ok: false, status: 409, code: 'offset_exists', error: 'This request was already charged to the balance' }
  }
  if (!payable(r)) return { ok: false, status: 409, code: 'not_payable', error: 'This request is not waiting for payment' }

  await retireDoorTeamCardSession(r)
  const debit = await debitReleasedBalance({
    orgId: r.organizer_id,
    totalMinor: Math.round(price * 100),
    preferEventId: r.event_id,
    withdrawalRef: rowRef,
    row: {
      purpose: 'door_team',
      doorTeamRequestId: r.id,
      doorTeamEventId: r.event_id,
      note: `Door team: ${r.staff_count} staff × ${r.hours}h`,
      requestedBy: user.id,
    },
  })
  if (!debit.ok) {
    if (debit.alreadyExists && !params.retried) return payDoorTeamFromBalance({ ...params, retried: true })
    const error = debit.code === 'insufficient_balance' ? 'Your released balance does not cover this request' : debit.error
    return { ok: false, status: debit.status, code: debit.code, error }
  }
  const paid = await markRequestPaid(r.id, proof(debit.eventId))
  if (!paid.ok) {
    await creditBackDoorTeamOffset(r.id, 'system')
    return { ok: false, status: 409, code: 'not_payable', error: 'This request can no longer be paid' }
  }
  await afterPaid(r.id)
  return { ok: true, withdrawalId: rowRef.id }
}

/**
 * Credit a balance payment back, once, in ONE transaction (ledger + row +
 * request stamp). With `cancel`, the request is cancelled in the same
 * transaction and its refund recorded as credited.
 */
export async function creditBackDoorTeamOffset(
  requestId: string,
  by: string,
  cancel?: { reason: string }
): Promise<{ ok: boolean; code?: string; amountMinor?: number }> {
  const rowRef = adminDb.collection('withdrawal_requests').doc(doorTeamOffsetId(requestId))
  const ref = requestRef(requestId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const rowSnap = await tx.get(rowRef)
    if (!rowSnap.exists) return { ok: false, code: 'no_offset' }
    const row = rowSnap.data() || {}
    if (row.doorTeamRequestId !== requestId) return { ok: false, code: 'not_offset' }
    if (!isLiveOffsetRow(row)) return { ok: false, code: 'already_credited' }
    const r = snap.exists ? snap.data() || {} : null
    if (cancel && r && !['paid', 'confirmed', 'cancelled'].includes(String(r.status))) return { ok: false, code: 'not_cancellable' }
    const amount = await reverseOffsetRowInTransaction(tx, rowRef, row, by, 'door_team_cancelled')
    if (r) {
      const nowIso = new Date().toISOString()
      tx.update(ref, {
        'payment.refunded_to_balance_at': nowIso,
        'payment.refunded_to_balance_by': by,
        refund: { due: true, rail: 'balance_offset', amount: amount / 100, currency: 'HTG', status: 'credited', credited_at: nowIso },
        ...(cancel && r.status !== 'cancelled'
          ? {
              status: 'cancelled',
              cancel_reason: cancel.reason,
              cancelled_by: by,
              cancelled_at: nowIso,
              history: [...(r.history || []), { at: nowIso, by, action: 'cancelled', refund: 'credit_balance' }],
            }
          : {}),
        updated_at: nowIso,
      })
    }
    return { ok: true, amountMinor: amount }
  })
}

/**
 * A debit that landed without the request being marked paid (a crash in
 * between): quoted → finish it; closed → credit it back. Called before any
 * path acts on an unpaid request (sweep, check payment, cancel).
 */
export async function reconcileDoorTeamOffset(requestId: string): Promise<'none' | 'finished_paid' | 'credited' | 'kept'> {
  const rowSnap = await adminDb.collection('withdrawal_requests').doc(doorTeamOffsetId(requestId)).get()
  const row = rowSnap.exists ? rowSnap.data() || {} : null
  if (!row || !isLiveOffsetRow(row) || row.doorTeamRequestId !== requestId) return 'none'
  const r = await getRequest(requestId)
  if (!r) return 'none'
  if (r.status === 'quoted') {
    const paid = await markRequestPaid(requestId, {
      funds_rail: 'balance_offset',
      reference: rowSnap.id,
      amount: Number(r.price_htg),
      currency: 'HTG',
      price_htg: Number(r.price_htg),
      extra: { offset_event_id: row.eventId, withdrawal_id: rowSnap.id, recovered: true },
    })
    if (paid.ok) {
      await afterPaid(requestId)
      return 'finished_paid'
    }
  }
  const fresh = await getRequest(requestId)
  if (fresh && ['cancelled', 'declined', 'expired'].includes(fresh.status) && !fresh.payment?.refunded_to_balance_at) {
    const c = await creditBackDoorTeamOffset(requestId, 'system')
    return c.ok ? 'credited' : 'kept'
  }
  return 'kept'
}

async function afterPaid(requestId: string): Promise<void> {
  const r = await getRequest(requestId)
  if (r) await notifyAdmins(r, 'paid')
}

// ── check & cancel ───────────────────────────────────────────────────────────

/** Ask the rail of the current attempt whether it was paid. */
export async function checkDoorTeamPayment(r: DoorTeamRequest, sessionId?: string | null): Promise<{ paid: boolean; reason?: string | null }> {
  if (['paid', 'confirmed', 'done'].includes(r.status)) return { paid: true }
  if ((await reconcileDoorTeamOffset(r.id)) === 'finished_paid') return { paid: true }
  const sid = String(sessionId || r.payment?.stripe_session_id || '')
  if (r.payment?.method === 'card' && sid) {
    const v = await verifyCardDoorTeamPayment(sid, r.id)
    return { paid: v.paid, reason: v.reason || null }
  }
  if (r.payment?.order_id) {
    const v = await verifyMonCashDoorTeamPayment(String(r.payment.order_id))
    return { paid: v.paid, reason: v.reason || null }
  }
  return { paid: false, reason: 'no_payment_started' }
}

export type CancelResult =
  | { ok: true; refund: 'none' | 'credit_balance' | 'refund_original'; creditedHtg?: number }
  | { ok: false; status: number; code: string; error: string }

/**
 * Organizer cancellation (lib/doorTeam/rules.ts cancelDecision):
 *   unpaid → cancelled; paid ≥ refundCutoffHours before the event → refunded
 *   (balance: credited back now; MonCash / card: flagged for the admin to refund
 *   to the original method); later → cancelled without refund. The crew's door
 *   access is removed either way.
 */
export async function cancelDoorTeamRequest(r: DoorTeamRequest, by: string, now = Date.now()): Promise<CancelResult> {
  // A balance debit that never got marked paid: settle it before deciding.
  if (r.status === 'quoted') await reconcileDoorTeamOffset(r.id)
  const fresh = (await getRequest(r.id)) || r
  const config = await loadDoorTeamConfig()
  const decision = cancelDecision(fresh, { now, refundCutoffHours: config.refundCutoffHours })
  if (!decision.ok) return { ok: false, status: 409, code: decision.code, error: 'This request can no longer be cancelled' }

  if (decision.refund === 'credit_balance') {
    const c = await creditBackDoorTeamOffset(fresh.id, by, { reason: 'organizer_cancelled' })
    if (!c.ok && c.code !== 'already_credited') return { ok: false, status: 409, code: c.code || 'credit_failed', error: 'The balance could not be credited back' }
    await revokeCrewAccess(fresh)
    return { ok: true, refund: 'credit_balance', creditedHtg: (c.amountMinor || 0) / 100 }
  }

  const ref = requestRef(fresh.id)
  const out = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'not_found'
    const cur = snap.data() || {}
    if (cur.status !== fresh.status) return 'changed'
    const nowIso = new Date(now).toISOString()
    const refundOriginal = decision.refund === 'refund_original'
    tx.update(ref, {
      status: 'cancelled',
      cancel_reason: decision.reason === 'too_late' ? 'organizer_cancelled_late' : 'organizer_cancelled',
      cancelled_by: by,
      cancelled_at: nowIso,
      ...(cur.payment?.status === 'pending' ? { 'payment.status': 'abandoned' } : {}),
      refund: refundOriginal
        ? { due: true, rail: cur.payment?.funds_rail || null, amount: cur.payment?.amount ?? null, currency: cur.payment?.currency || null, status: 'pending' }
        : { due: false, status: 'none' },
      ...(refundOriginal ? { needs_refund: true } : {}),
      updated_at: nowIso,
      history: [...(cur.history || []), { at: nowIso, by, action: 'cancelled', refund: decision.refund, reason: decision.reason }],
    })
    return 'ok'
  })
  if (out !== 'ok') return { ok: false, status: 409, code: out, error: 'This request changed. Reload and try again.' }
  await retireDoorTeamCardSession(fresh)
  await revokeCrewAccess(fresh)
  if (decision.refund === 'refund_original') await notifyAdmins(fresh, 'refund_due')
  return { ok: true, refund: decision.refund }
}

// ── sweep ────────────────────────────────────────────────────────────────────

/**
 * From /api/cron/inventory-sweep:
 *   - quoted requests past their close (the quote's, or a later in-flight
 *     attempt's window): one last gateway check, then expired;
 *   - confirmed requests past the crew's access window: done, door access removed.
 */
export async function sweepDoorTeam(opts: { now?: number; limit?: number } = {}): Promise<{ expired: number; paid: number; done: number }> {
  const now = opts.now ?? Date.now()
  let expired = 0
  let paid = 0
  let done = 0
  const quoted = await adminDb.collection('door_team_requests').where('status', '==', 'quoted').limit(opts.limit ?? 100).get()
  for (const doc of quoted.docs) {
    const r = { id: doc.id, ...(doc.data() || {}) } as DoorTeamRequest
    const closes = Math.max(toDate(r.quote_expires_at)?.getTime() || 0, toDate(r.payment_expires_at)?.getTime() || 0)
    if (!closes || closes >= now) continue
    try {
      const check = await checkDoorTeamPayment(r)
      if (check.paid) {
        paid++
        continue
      }
    } catch (err: any) {
      console.warn('[door-team] expiry check failed; kept', { id: r.id, message: err?.message })
      continue
    }
    const moved = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(requestRef(r.id))
      const cur = snap.data() || {}
      if (cur.status !== 'quoted') return false
      const nowIso = new Date(now).toISOString()
      tx.update(requestRef(r.id), {
        status: 'expired',
        ...(cur.payment?.status === 'pending' ? { 'payment.status': 'abandoned' } : {}),
        updated_at: nowIso,
        history: [...(cur.history || []), { at: nowIso, by: 'system', action: 'expired' }],
      })
      return true
    })
    if (moved) {
      expired++
      await retireDoorTeamCardSession(r)
    }
  }
  const confirmed = await adminDb.collection('door_team_requests').where('status', '==', 'confirmed').limit(opts.limit ?? 100).get()
  for (const doc of confirmed.docs) {
    const until = toDate(doc.data()?.access_until)?.getTime()
    if (until && until < now) {
      const m = await completeRequest(doc.id, 'system')
      if (m.ok) done++
    }
  }
  return { expired, paid, done }
}
