/**
 * The promoter wallet: funded commission a claimed promoter can actually
 * withdraw, and the withdrawal itself.
 *
 * Availability is LINKED TO THE ORGANIZER'S RELEASE STATE by design: a
 * commission becomes withdrawable exactly when its event's funds release to the
 * organizer (loadEventAvailability's holds, then the release ladder). Until
 * then it shows as pending. This kills the obvious fraud loop — a fake
 * organizer's "promoter" cashing out stolen-card sales before review — because
 * the commission is held by the very ladder that holds the organizer.
 *
 * Money model:
 *  - Only FUNDED promoter_sales count (rows written since withholding shipped;
 *    older tallies are settled organizer-to-promoter directly).
 *  - Balances accrue per event currency. Withdrawals pay out in HTG over
 *    MonCash: HTG balances directly, USD balances converted at withdrawal time
 *    (same fetchUsdToHtgRate the organizer instant path uses). Other currencies
 *    are shown but not withdrawable on this rail.
 *  - The promoter pays the 3% prefunding fee, mirroring organizer instant
 *    withdrawals.
 */

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { previewRelease } from '@/lib/payouts/withdrawal-gate'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { gateEventData, type EventAvailability } from '@/lib/payouts/availability'
import { excludeStripeConnectSales } from '@/lib/promoters'
import {
  computePrefundedPayout,
  executePrefundedTransfer,
  normalizeMoncashReceiver,
  prefundedBalanceCovers,
} from '@/lib/payouts/moncash-prefunded'
import { fetchUsdToHtgRate } from '@/lib/currency'
import { finalizeWithdrawalCompleted, releaseWithdrawalReservation } from '@/lib/payouts/withdrawal-finalize'
import { notifyWithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'
import {
  consumePayoutDetailsChangeVerification,
  getOrganizerIdentityVerificationStatus,
  mobileMoneyFingerprint,
  NEW_PAYOUT_DESTINATION_HOLD_MS,
  requireRecentPayoutDetailsChangeVerification,
} from '@/lib/firestore/payout'

export const PROMOTER_WITHDRAWAL_FEE_PERCENT = 0.03
/** 500 HTG — small enough for street-team amounts, big enough to be worth a transfer. */
export const PROMOTER_MIN_WITHDRAWAL_HTG_CENTS = 50_000

const WITHDRAWABLE_CURRENCIES = new Set(['HTG', 'USD'])

export interface WalletEventLine {
  eventId: string
  eventTitle: string
  currency: string
  commissionCents: number
  released: boolean
  availableAt: string | null
}

export interface PromoterWalletView {
  /** Released commission minus what was already withdrawn, per currency. */
  availableByCurrency: Record<string, number>
  /**
   * Withdrawn commission that has since been REVERSED (refunds after the
   * promoter was paid): what the promoter owes back, per currency. Any debt
   * blocks withdrawals until new commission covers it.
   */
  owedByCurrency: Record<string, number>
  /** Commission still held with its event, per currency. */
  pendingByCurrency: Record<string, number>
  /** Non-HTG/USD released amounts — visible, not withdrawable on this rail. */
  unsupportedByCurrency: Record<string, number>
  withdrawnByCurrency: Record<string, number>
  events: WalletEventLine[]
  moncashPhone: string | null
  /** When the saved MonCash number becomes payable (24h after it was saved). */
  moncashPhoneAvailableAt: string | null
  /** True once the saved number went through the verified save path. */
  moncashPhoneVerified: boolean
  feePercent: number
  minWithdrawalHtgCents: number
}

/**
 * Pure bucket math, split out for tests. The balance is SIGNED: commission is
 * accrued (released + pending) minus withdrawn, per currency. When a commission
 * the promoter already withdrew is reversed, accrued drops below withdrawn and
 * the difference is a debt (owedByCurrency) instead of silently vanishing in a
 * Math.max(0, …). Available is released minus withdrawn, and only when the
 * currency carries no debt.
 */
export function computeWalletBuckets(
  lines: Array<Pick<WalletEventLine, 'currency' | 'commissionCents' | 'released'>>,
  withdrawnByCurrency: Record<string, number>
): {
  availableByCurrency: Record<string, number>
  pendingByCurrency: Record<string, number>
  unsupportedByCurrency: Record<string, number>
  owedByCurrency: Record<string, number>
} {
  const released: Record<string, number> = {}
  const pending: Record<string, number> = {}
  for (const line of lines) {
    const currency = String(line.currency || 'HTG').toUpperCase()
    const cents = Math.max(0, Math.round(Number(line.commissionCents) || 0))
    if (cents <= 0) continue
    if (line.released) released[currency] = (released[currency] || 0) + cents
    else pending[currency] = (pending[currency] || 0) + cents
  }

  const available: Record<string, number> = {}
  const unsupported: Record<string, number> = {}
  const owed: Record<string, number> = {}
  const currencies = new Set([...Object.keys(released), ...Object.keys(pending), ...Object.keys(withdrawnByCurrency || {})])
  for (const rawCurrency of currencies) {
    const currency = String(rawCurrency).toUpperCase()
    const withdrawn = Math.max(0, Math.round(Number(withdrawnByCurrency?.[rawCurrency]) || 0))
    const accrued = (released[currency] || 0) + (pending[currency] || 0)
    if (withdrawn > accrued) {
      owed[currency] = (owed[currency] || 0) + (withdrawn - accrued)
      continue
    }
    const net = (released[currency] || 0) - withdrawn
    if (net <= 0) continue
    if (WITHDRAWABLE_CURRENCIES.has(currency)) available[currency] = net
    else unsupported[currency] = net
  }
  return {
    availableByCurrency: available,
    pendingByCurrency: pending,
    unsupportedByCurrency: unsupported,
    owedByCurrency: owed,
  }
}

/** The 3% fee and net payout for a gross HTG amount. Promoter pays the fee. */
export function computeWithdrawalFee(grossHtgCents: number): {
  feeCents: number
  payoutCents: number
} {
  const gross = Math.max(0, Math.round(Number(grossHtgCents) || 0))
  const feeCents = Math.round(gross * PROMOTER_WITHDRAWAL_FEE_PERCENT)
  return { feeCents, payoutCents: Math.max(0, gross - feeCents) }
}

async function walletRef(uid: string) {
  return adminDb.collection('promoter_wallets').doc(String(uid))
}

/**
 * Funded, accrued commission grouped per event for everything this account claimed.
 *
 * Excluded, so they can never be withdrawn from Tikèm's pool:
 *  - `funded: false` rows (Stripe Connect sales are written that way: the
 *    money is in the organizer's own Stripe account, Tikèm never held it);
 *  - Connect rows written `funded: true` before that change. They are
 *    recognised by the row's payment_method, or, for rows the client-confirm
 *    path wrote as plain 'stripe', by the sold ticket's payment_method
 *    (see excludeStripeConnectSales).
 */
async function loadFundedLines(uid: string): Promise<Array<{ eventId: string; currency: string; commissionCents: number }>> {
  const promotersSnap = await adminDb
    .collection('event_promoters')
    .where('claimed_by_uid', '==', uid)
    .limit(100)
    .get()

  const perEvent = new Map<string, { eventId: string; currency: string; commissionCents: number }>()
  await Promise.all(
    promotersSnap.docs.map(async (d: any) => {
      // An organizer's commission on their own event is not theirs to withdraw
      // as a promoter (claims by the organizer are refused; this covers rows
      // claimed before that rule).
      if (String(d.data()?.organizer_id || '') === String(uid)) return
      const salesSnap = await adminDb
        .collection('promoter_sales')
        .where('promoter_id', '==', d.id)
        .where('funded', '==', true)
        .get()
      const candidates = salesSnap.docs
        .map((saleDoc: any) => saleDoc.data() || {})
        .filter((s: any) => s.funded === true && s.status === 'accrued')
      const sales = await excludeStripeConnectSales(candidates)
      sales.forEach((s: any) => {
        const cents = Math.max(0, Number(s.commission_cents) || 0)
        if (cents <= 0) return
        const eventId = String(s.event_id)
        const currency = String(s.currency || 'HTG').toUpperCase()
        const key = `${eventId}|${currency}`
        const line = perEvent.get(key) || { eventId, currency, commissionCents: 0 }
        line.commissionCents += cents
        perEvent.set(key, line)
      })
    })
  )
  return Array.from(perEvent.values())
}

/**
 * Availability states that hold the promoter's commission no matter what the
 * ladder says: integrity holds, cancellation/freeze, review, and any refund
 * still being decided or executed (the commission on that order is about to be
 * reversed, so it must not be withdrawable in the meantime).
 */
const PROMOTER_HARD_HOLDS = new Set<string>([
  'payouts_frozen',
  'event_cancelled',
  'earnings_currency_review',
  'ticket_currency_review',
  'ledger_gross_exceeded',
  'release_unknown',
  'payout_under_review',
])

export function promoterHoldFromAvailability(
  a: Pick<EventAvailability, 'reason' | 'refundRequestedMinor' | 'refundInFlightMinor'>
): string | null {
  if (PROMOTER_HARD_HOLDS.has(String(a.reason))) return String(a.reason)
  if ((Number(a.refundRequestedMinor) || 0) > 0) return 'refund_requested'
  if ((Number(a.refundInFlightMinor) || 0) > 0) return 'refund_in_flight'
  return null
}

/**
 * Ask the organizer's release machinery whether this event's funds are out,
 * the way an organizer withdrawal is gated: the server-authoritative
 * availability (ticket-stamped end, integrity and refund holds) first, then the
 * release ladder judged against gateEventData (never the organizer-editable
 * end_datetime). When the organizer has already taken their whole balance the
 * availability reads "nothing owed", so the ladder is asked again with the
 * promoter's own commission as the amount at stake.
 */
async function isEventReleased(
  eventId: string,
  commissionMinor: number
): Promise<{ released: boolean; availableAt: string | null; title: string }> {
  try {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    const eventData = eventDoc.exists ? (eventDoc.data() as any) : {}
    const title = String(eventData?.title || 'Event')
    if (!eventDoc.exists) return { released: false, availableAt: null, title }

    const a = await loadEventAvailability({ eventId, eventData })
    if (!a) return { released: false, availableAt: null, title }
    if (promoterHoldFromAvailability(a)) return { released: false, availableAt: a.availableAt, title }
    if (a.releasedNow) return { released: true, availableAt: a.availableAt, title }

    const release = await previewRelease({
      eventId,
      organizerId: String(eventData?.organizer_id || eventData?.organizerId || ''),
      eventData: gateEventData(eventData, a),
      grossMinor: a.gateInputs.grossMinor,
      refundedMinor: a.gateInputs.refundedMinor,
      currency: a.currency,
      availableMinor: Math.max(0, Math.round(Number(commissionMinor) || 0)),
    })
    return {
      released: Boolean(release?.releasedNow),
      availableAt: release?.availableAt || a.availableAt || null,
      title,
    }
  } catch (err: any) {
    // Fail CLOSED: a release check that cannot run must hold the money.
    console.error('[promoter-wallet] release check failed; holding', { eventId, message: err?.message })
    return { released: false, availableAt: null, title: 'Event' }
  }
}

export async function getPromoterWalletView(uid: string): Promise<PromoterWalletView> {
  const [lines, walletSnap] = await Promise.all([loadFundedLines(uid), (await walletRef(uid)).get()])
  const wallet = walletSnap.exists ? (walletSnap.data() as any) : {}
  const withdrawnByCurrency: Record<string, number> = { ...(wallet?.withdrawn_by_currency || {}) }

  const releaseByEvent = new Map<string, { released: boolean; availableAt: string | null; title: string }>()
  const commissionByEvent = new Map<string, number>()
  for (const l of lines) commissionByEvent.set(l.eventId, (commissionByEvent.get(l.eventId) || 0) + l.commissionCents)
  await Promise.all(
    Array.from(commissionByEvent.entries()).map(async ([eventId, commission]) => {
      releaseByEvent.set(eventId, await isEventReleased(eventId, commission))
    })
  )

  const events: WalletEventLine[] = lines.map((l) => {
    const release = releaseByEvent.get(l.eventId) || { released: false, availableAt: null, title: 'Event' }
    return {
      eventId: l.eventId,
      eventTitle: release.title,
      currency: l.currency,
      commissionCents: l.commissionCents,
      released: release.released,
      availableAt: release.availableAt,
    }
  })

  const buckets = computeWalletBuckets(events, withdrawnByCurrency)
  const verified = Boolean(wallet?.moncash_phone_fingerprint)
  return {
    ...buckets,
    withdrawnByCurrency,
    events,
    moncashPhone: wallet?.moncash_phone ? String(wallet.moncash_phone) : null,
    moncashPhoneAvailableAt: verified && wallet?.moncash_phone_hold_until ? String(wallet.moncash_phone_hold_until) : null,
    moncashPhoneVerified: verified,
    feePercent: PROMOTER_WITHDRAWAL_FEE_PERCENT,
    minWithdrawalHtgCents: PROMOTER_MIN_WITHDRAWAL_HTG_CENTS,
  }
}

/** The account's SMS-verified sign-in phone, normalized to 509XXXXXXXX, if any. */
async function verifiedAuthPhone(uid: string): Promise<string | null> {
  try {
    const record = await adminAuth.getUser(uid)
    return record?.phoneNumber ? normalizeMoncashReceiver(record.phoneNumber) : null
  } catch {
    return null
  }
}

/**
 * Identity for a promoter payout, the lighter of two:
 *  - the account passed organizer identity verification (KYC), or
 *  - the MonCash wallet being paid is the account's own SMS-verified sign-in
 *    phone. MonCash wallets are registered by Digicel to the SIM holder, so
 *    this pays only a Digicel-identified person who proved control of that SIM
 *    when signing in — enough for street-team amounts without making every
 *    promoter upload an ID.
 */
async function promoterIdentityOk(uid: string, destination: string): Promise<boolean> {
  const authPhone = await verifiedAuthPhone(uid)
  if (authPhone && authPhone === destination) return true
  try {
    return (await getOrganizerIdentityVerificationStatus(uid)) === 'verified'
  } catch {
    return false
  }
}

export type PromoterWithdrawalResult =
  | {
      ok: true
      withdrawalId: string
      instant: boolean
      /** Sent over the prefunded rail but not confirmed; held for an admin. */
      confirming?: boolean
      grossHtgCents: number
      feeCents: number
      payoutHtgCents: number
    }
  | {
      ok: false
      code:
        | 'below_minimum'
        | 'nothing_available'
        | 'invalid_phone'
        | 'conflict'
        | 'transfer_failed'
        | 'identity_required'
        | 'verification_required'
        | 'destination_on_hold'
        | 'balance_negative'
      error: string
      availableAt?: string
    }

/**
 * Withdraw the promoter's ENTIRE available balance to their MonCash number.
 * Instant over the prefunded pool when the platform has it on; otherwise a
 * pending withdrawal_requests row for the admin queue (no fee on that path,
 * matching organizer standard withdrawals).
 */
export async function executePromoterWithdrawal(uid: string, rawPhone: string): Promise<PromoterWithdrawalResult> {
  // Digicel's Transfert wants 509XXXXXXXX; "+509 3700 7294" must not reach it verbatim.
  const phone = normalizeMoncashReceiver(rawPhone)
  const fingerprint = mobileMoneyFingerprint(phone)
  if (!phone || !fingerprint) {
    return { ok: false, code: 'invalid_phone', error: 'Enter a valid MonCash phone number.' }
  }

  // 1. Identity (see promoterIdentityOk), before anything is saved or spent.
  if (!(await promoterIdentityOk(uid, phone))) {
    return {
      ok: false,
      code: 'identity_required',
      error:
        'To withdraw, sign in to Tikèm with the phone number of this MonCash wallet, or complete identity verification.',
    }
  }

  // 2. The destination is the wallet's SAVED number. A different (or first)
  //    number is saved here, behind the emailed step-up code (waived when it is
  //    the account's own SMS-verified phone), and only becomes payable 24 hours
  //    later — the same hold an organizer's payout-destination change gets.
  const ref = await walletRef(uid)
  const walletSnap = await ref.get()
  const stored = walletSnap.exists ? ((walletSnap.data() as any) ?? {}) : {}
  if (stored.moncash_phone_fingerprint !== fingerprint) {
    const isOwnVerifiedPhone = (await verifiedAuthPhone(uid)) === phone
    if (!isOwnVerifiedPhone) {
      try {
        await requireRecentPayoutDetailsChangeVerification(uid)
      } catch (e: any) {
        if (String(e?.message || '').includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
          return {
            ok: false,
            code: 'verification_required',
            error: 'For your security, confirm this MonCash number with the code we email you.',
          }
        }
        throw e
      }
    }
    const savedAt = new Date()
    const holdUntil = new Date(savedAt.getTime() + NEW_PAYOUT_DESTINATION_HOLD_MS).toISOString()
    await ref.set(
      {
        moncash_phone: phone,
        moncash_phone_fingerprint: fingerprint,
        moncash_phone_set_at: savedAt.toISOString(),
        moncash_phone_hold_until: holdUntil,
        moncash_phone_verified_via: isOwnVerifiedPhone ? 'auth_phone' : 'email_code',
        updated_at: savedAt.toISOString(),
      },
      { merge: true }
    )
    if (!isOwnVerifiedPhone) await consumePayoutDetailsChangeVerification(uid)
    return {
      ok: false,
      code: 'destination_on_hold',
      error: 'MonCash number saved. For your security, withdrawals to a new number open 24 hours after it is saved.',
      availableAt: holdUntil,
    }
  }
  const holdUntilMs = Date.parse(String(stored.moncash_phone_hold_until || ''))
  if (Number.isFinite(holdUntilMs) && holdUntilMs > Date.now()) {
    return {
      ok: false,
      code: 'destination_on_hold',
      error: 'For your security, withdrawals to this MonCash number open 24 hours after it was saved.',
      availableAt: new Date(holdUntilMs).toISOString(),
    }
  }

  const view = await getPromoterWalletView(uid)
  if (Object.values(view.owedByCurrency || {}).some((c) => Number(c) > 0)) {
    return {
      ok: false,
      code: 'balance_negative',
      error: 'Refunds reversed commission you already withdrew. New commission covers that first, then you can withdraw again.',
    }
  }
  const htgCents = Math.max(0, Number(view.availableByCurrency.HTG) || 0)
  const usdCents = Math.max(0, Number(view.availableByCurrency.USD) || 0)
  if (htgCents <= 0 && usdCents <= 0) {
    return { ok: false, code: 'nothing_available', error: 'Nothing is available to withdraw yet.' }
  }

  const usdToHtgRate = usdCents > 0 ? await fetchUsdToHtgRate() : 1
  const grossHtgCents = htgCents + Math.round((usdCents / 100) * usdToHtgRate * 100)
  if (grossHtgCents < PROMOTER_MIN_WITHDRAWAL_HTG_CENTS) {
    return {
      ok: false,
      code: 'below_minimum',
      error: `Minimum withdrawal is ${(PROMOTER_MIN_WITHDRAWAL_HTG_CENTS / 100).toLocaleString()} HTG.`,
    }
  }

  // Instant only when the platform prefunding pool is on and stocked.
  const configDoc = await adminDb.collection('config').doc('payouts').get()
  const prefunding = configDoc.exists ? (configDoc.data() as any)?.prefunding : null
  // The cron's `available` is up to 15 minutes old; check the pool covers THIS
  // transfer plus Digicel's 3% before promising an instant payout.
  const instantPricing = computePrefundedPayout(grossHtgCents)
  const instant =
    Boolean(prefunding?.enabled) &&
    Boolean(prefunding?.available) &&
    (await prefundedBalanceCovers(instantPricing.poolDebitHtgCents))

  // Promoter pays the 3% on the instant rail; the manual/admin rail is free,
  // exactly like organizer withdrawals.
  const { feeCents, payoutCents } = instant
    ? computeWithdrawalFee(grossHtgCents)
    : { feeCents: 0, payoutCents: grossHtgCents }

  const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
  const now = new Date()

  // Reserve first: bump withdrawn counters under optimistic concurrency so a
  // double-tap cannot pay twice. The view's withdrawn snapshot is the guard.
  try {
    await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const walletNow = snap.exists ? ((snap.data() as any) ?? {}) : {}
      // The destination checked above must still be the saved, payable one.
      const holdNow = Date.parse(String(walletNow.moncash_phone_hold_until || ''))
      if (walletNow.moncash_phone_fingerprint !== fingerprint || (Number.isFinite(holdNow) && holdNow > Date.now())) {
        throw new Error('conflict')
      }
      const stored = walletNow.withdrawn_by_currency || {}
      for (const currency of Object.keys({ ...stored, ...view.withdrawnByCurrency })) {
        if ((Number(stored[currency]) || 0) !== (Number(view.withdrawnByCurrency[currency]) || 0)) {
          throw new Error('conflict')
        }
      }
      tx.set(
        ref,
        {
          withdrawn_by_currency: {
            ...stored,
            ...(htgCents > 0 ? { HTG: (Number(stored.HTG) || 0) + htgCents } : {}),
            ...(usdCents > 0 ? { USD: (Number(stored.USD) || 0) + usdCents } : {}),
          },
          updated_at: now.toISOString(),
        },
        { merge: true }
      )
      tx.set(withdrawalRef, {
        payee_type: 'promoter',
        promoter_uid: uid,
        // Kept for the admin queue's rendering; for a promoter row this is the
        // PAYEE's uid, not an organizer.
        organizerId: uid,
        eventId: null,
        amount: grossHtgCents,
        currency: 'HTG',
        method: 'moncash',
        status: instant ? 'processing' : 'pending',
        moncashNumber: phone,
        destinationFingerprint: fingerprint,
        destinationCheck: 'promoter_saved_destination',
        feeCents: feeCents || undefined,
        payoutAmountCents: payoutCents,
        payoutCurrency: 'HTG',
        payoutAmountHtgCents: payoutCents,
        usdToHtgRateUsed: usdCents > 0 ? usdToHtgRate : undefined,
        prefundingUsed: instant || undefined,
        prefundingFeePercent: instant ? PROMOTER_WITHDRAWAL_FEE_PERCENT : undefined,
        // Digicel's own 3% on the amount sent — Tikèm's cost, kept apart from feeCents.
        prefundingProviderFeeHtgCents: instant ? instantPricing.providerFeeHtgCents : undefined,
        prefundingPoolDebitHtgCents: instant ? instantPricing.poolDebitHtgCents : undefined,
        prefundingPlatformNetHtgCents: instant ? feeCents - instantPricing.providerFeeHtgCents : undefined,
        // What was debited from the wallet, per currency — the admin
        // reject/fail path credits exactly this back.
        walletDebits: {
          ...(htgCents > 0 ? { HTG: htgCents } : {}),
          ...(usdCents > 0 ? { USD: usdCents } : {}),
        },
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (err: any) {
    if (String(err?.message) === 'conflict') {
      return { ok: false, code: 'conflict', error: 'Your balance changed. Reload and try again.' }
    }
    throw err
  }

  // What the notices render from; mirrors the row just written.
  const noticeRow = {
    payee_type: 'promoter',
    promoter_uid: uid,
    organizerId: uid,
    amount: grossHtgCents,
    currency: 'HTG',
    moncashNumber: phone,
    payoutAmountHtgCents: payoutCents,
  }

  if (!instant) {
    await notifyWithdrawalOutcome(withdrawalRef.id, 'submitted', { row: noticeRow })
    return { ok: true, withdrawalId: withdrawalRef.id, instant: false, grossHtgCents, feeCents, payoutHtgCents: payoutCents }
  }

  const outcome = await executePrefundedTransfer({
    amount: Number((payoutCents / 100).toFixed(2)),
    receiver: phone,
    desc: 'Tikèm promoter commission withdrawal',
    reference: withdrawalRef.id,
  })

  if (outcome.outcome === 'completed') {
    const done = await finalizeWithdrawalCompleted(withdrawalRef.id, {
      transactionId: outcome.transactionId,
      raw: outcome.raw,
      confirmedVia: outcome.confirmedVia,
    })
    if (done.changed) await notifyWithdrawalOutcome(withdrawalRef.id, 'completed', { row: done.row })
    return { ok: true, withdrawalId: withdrawalRef.id, instant: true, grossHtgCents, feeCents, payoutHtgCents: payoutCents }
  }

  if (outcome.outcome === 'unconfirmed') {
    // The money MAY have moved: keep the wallet debit (restoring it would allow
    // a second withdrawal of the same money) and leave it for an admin.
    console.error('[promoter-wallet] prefunded transfer outcome unknown; held for reconciliation', {
      withdrawalId: withdrawalRef.id,
      reason: outcome.reason,
      statusCheck: outcome.statusCheck,
    })
    await withdrawalRef.set(
      {
        status: 'processing',
        needsReconciliation: true,
        reconciliationReason: outcome.reason,
        reconciliationStatusCheck: outcome.statusCheck,
        updatedAt: new Date(),
      },
      { merge: true }
    )
    await notifyWithdrawalOutcome(withdrawalRef.id, 'confirming', { row: noticeRow })
    return {
      ok: true,
      withdrawalId: withdrawalRef.id,
      instant: false,
      confirming: true,
      grossHtgCents,
      feeCents,
      payoutHtgCents: payoutCents,
    }
  }

  // Definitively rejected by MonCash: nothing moved, put the money back —
  // exactly the recorded walletDebits, once, in the same transaction that flips
  // the row to 'failed' (so a concurrent admin fail or cron run cannot also credit).
  const released = await releaseWithdrawalReservation(withdrawalRef.id, {
    reason: outcome.reason || 'MonCash transfer failed',
    releasedBy: 'promoter_withdraw',
  })
  if (released.changed) await notifyWithdrawalOutcome(withdrawalRef.id, 'failed', { row: released.row })
  return { ok: false, code: 'transfer_failed', error: 'The MonCash transfer failed. Your balance was restored. Try again shortly.' }
}

// Crediting a wallet back lives in lib/payouts/withdrawal-finalize.ts
// (releaseWithdrawalReservation): guarded so it can only happen once per row.
