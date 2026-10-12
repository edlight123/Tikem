import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  EARNINGS_CURRENCY_REVIEW_CODE,
  EARNINGS_CURRENCY_REVIEW_MESSAGE,
  flagEarningsCurrencyReview,
  getOrCreateEventEarnings,
  readRefundClaimVersion,
  refundClaimVersionOf,
  REFUND_CLAIMED_RETRY_CODE,
  REFUND_CLAIMED_RETRY_MESSAGE,
  storedEarningsCurrencyMismatch,
  withdrawFromEarnings,
} from '@/lib/earnings'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { gateEventData, integrityRefusal } from '@/lib/payouts/availability'
import type { WithdrawalRequest } from '@/types/earnings'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'
import {
  checkMobileMoneyDestination,
  consumePayoutDetailsChangeVerification,
  enrollLegacyMobileMoneyFingerprint,
  requireRecentPayoutDetailsChangeVerification,
} from '@/lib/firestore/payout'
import { getUsdToHtgBaseRate, isFxRateUnavailableError, type UsdToHtgBaseRateResult } from '@/lib/fx/usd-htg'
import { scheduleOpsEvent } from '@/lib/ops/ops-events'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import {
  PREFUNDING_FEE_PERCENT,
  computePrefundedPayout,
  executePrefundedTransfer,
  normalizeMoncashReceiver,
  prefundedBalanceCovers,
} from '@/lib/payouts/moncash-prefunded'
import {
  MONCASH_BELOW_MINIMUM_CODE,
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  meetsMoncashWithdrawalMinimum,
  moncashMinimumInfo,
} from '@/lib/payouts/moncash-withdrawal-minimum'
import { finalizeWithdrawalCompleted, releaseWithdrawalReservation } from '@/lib/payouts/withdrawal-finalize'
import { notifyWithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'
import { payoutFreezeStatus } from '@/lib/moderation/ban'
import { payoutProfileInactiveReason } from '@/lib/payouts/profile-readiness'
import { loadKycLegalNames, moncashNumberOtpVerified } from '@/lib/payouts/payee-identity'
import {
  INSTANT_MONCASH_DAYS_COLLECTION,
  dailyCapAllows,
  decideInstantMoncash,
  instantDayKey,
  loadMoncashTransferCaps,
} from '@/lib/payouts/instant-moncash-policy'
import {
  bookDebtRepaymentInTransaction,
  netDebtAgainstWithdrawal,
  readDebtInTransaction,
  syncOrganizerDebt,
} from '@/lib/payouts/organizer-debt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The instant rail's daily cap was reached inside the reservation transaction. */
class InstantDailyCapReached extends Error {}

/** A refusal raised inside the reservation transaction — a 4xx, not a crash. */
class ReservationRefused extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // A banned organizer, or one whose payouts an admin froze, withdraws
    // nothing — including money already earned and released (owner decision).
    const freeze = await payoutFreezeStatus(user.id)
    if (freeze.frozen) {
      return NextResponse.json({ error: freeze.message, message: freeze.message, code: freeze.code }, { status: 403 })
    }

    const haitiProfile = await getPayoutProfile(user.id, 'haiti')
    if (!haitiProfile) {
      return NextResponse.json(
        {
          error: 'Haiti payout profile required',
          message: 'MonCash withdrawals are only available for organizers with a Haiti payout profile.',
        },
        { status: 400 }
      )
    }

    // The REAL reason (identity pending, on hold until <time>, not set up),
    // not one "complete payout verification" for every inactive state.
    const inactive = payoutProfileInactiveReason(haitiProfile, 'MonCash')
    if (inactive) {
      return NextResponse.json(inactive, { status: 400 })
    }

    if (haitiProfile.method !== 'mobile_money') {
      return NextResponse.json(
        {
          error: 'Mobile money not configured',
          message: 'Please configure Haiti payout method as Mobile money to withdraw via MonCash.',
        },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { eventId, moncashNumber } = body || {}
    const amount = Number(body?.amount)

    // Validate inputs
    if (!eventId || !body?.amount || !moncashNumber) {
      return NextResponse.json(
        { error: 'Missing required fields: eventId, amount, moncashNumber' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be a whole number of cents' }, { status: 400 })
    }

    // Digicel's prefunded docs send `receiver` as 509XXXXXXXX. The forms collect
    // "+509 1234 5678" and similar, which must never reach Transfert verbatim.
    const receiver = normalizeMoncashReceiver(moncashNumber)
    if (!receiver) {
      return NextResponse.json(
        { error: 'Enter a valid Haitian MonCash number (8 digits, optionally with +509).', code: 'invalid_phone' },
        { status: 400 }
      )
    }

    // The number must be the destination saved on the payout profile, compared
    // on the FULL normalized number. A different number is changed in payout
    // settings, where it costs an emailed code and a 24h payout hold; it is
    // never accepted per request (queued requests used to store and pay
    // whatever number the request carried).
    const destination = checkMobileMoneyDestination(haitiProfile, receiver)
    if (!destination.ok) {
      return NextResponse.json(
        { error: destination.message, code: destination.code, message: destination.message },
        { status: 403 }
      )
    }

    // Verify event ownership
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const eventData = eventDoc.data()
    if (eventData?.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized for this event' }, { status: 403 })
    }

    // A cancelled event's takings are not the organizer's to withdraw: buyers are
    // being refunded from that same money. lib/events/cancel.ts sets this first,
    // precisely so this check can hold the line even if refunds are still running.
    if (eventData?.status === 'cancelled' || eventData?.payouts_frozen === true) {
      return NextResponse.json(
        { error: 'This event was cancelled, so its earnings are reserved for refunds.', code: 'cancelled_event' },
        { status: 400 }
      )
    }

    // Event-based routing: US/CA events must use Stripe Connect.
    const requiredProfile = getRequiredPayoutProfileIdForEventCountry(eventData?.country)
    if (requiredProfile === 'stripe_connect') {
      return NextResponse.json(
        {
          error: 'Stripe Connect required',
          message: 'US/Canada events must withdraw via Stripe Connect. MonCash is not available for this event.',
        },
        { status: 400 }
      )
    }

    // What this event can pay out — the one shared figure
    // (lib/payouts/availability.ts): ticket-derived net with the platform fee
    // checkout charged, refunds and every earlier withdrawal or batch payout
    // out. The earnings screens show this same number.
    // Recorded BEFORE the ceiling is computed: a refund claimed after this point
    // bumps it, and the debit below refuses instead of using a stale ceiling.
    const expectedRefundClaimVersion = await readRefundClaimVersion(String(eventId))
    const availability = await loadEventAvailability({ eventId: String(eventId), eventData })
    if (!availability) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // The event's real currency. This is the Haiti rail (MonCash executes in
    // HTG; USD earnings are converted at withdrawal below). A CAD/EUR event
    // would withdraw via Stripe, not here — but if one reaches this route we
    // must NOT silently rewrite CAD/EUR to HTG.
    const currency = availability.currency

    // A stored row in another currency than the event's: its withdrawals can be
    // neither validated nor debited safely, so nothing moves until an admin
    // corrects it (lib/earnings.ts storedEarningsCurrencyMismatch).
    if (availability.reason === EARNINGS_CURRENCY_REVIEW_CODE) {
      await flagEarningsCurrencyReview(String(eventId), { lastRefusedWithdrawalAt: new Date().toISOString() })
      return NextResponse.json(
        { error: EARNINGS_CURRENCY_REVIEW_MESSAGE, code: EARNINGS_CURRENCY_REVIEW_CODE, needsAdminReview: true },
        { status: 409 }
      )
    }

    // The money inputs disagree with what the payment paths recorded (a ticket
    // sold in another currency than the event now shows, or more ticket gross
    // than the server ledger ever booked): refuse for admin review.
    const integrity = integrityRefusal(availability)
    if (integrity) {
      return NextResponse.json(integrity.body, { status: integrity.status })
    }

    // MonCash transfers are executed in HTG. If earnings are in USD, we convert
    // at withdrawal time — and the 1,000 HTG floor is measured on that HTG value.
    // The hardened base rate (lib/fx/usd-htg.ts, no spread): live if it passes the
    // sanity checks, else the highest snapshot of the last 14 days. With neither,
    // nothing moves — there is no hardcoded fallback rate any more.
    let fxRate: UsdToHtgBaseRateResult | null = null
    if (currency === 'USD') {
      try {
        fxRate = await getUsdToHtgBaseRate({ fallback: 'lowest' })
      } catch (e) {
        if (!isFxRateUnavailableError(e)) throw e
        scheduleOpsEvent('fx_rate_unavailable', 'organizer/withdraw-moncash', { eventId: String(eventId) })
        return NextResponse.json(
          {
            error:
              "We can't get a reliable USD to HTG exchange rate right now, so this withdrawal can't be converted safely. Nothing was withdrawn. Please try again later.",
            code: 'fx_rate_unavailable',
          },
          { status: 503 }
        )
      }
      if (fxRate.source === 'snapshot_fallback') {
        scheduleOpsEvent('fx_snapshot_fallback', 'organizer/withdraw-moncash', {
          eventId: String(eventId),
          baseRate: fxRate.baseRate,
        })
      }
    }
    const usdToHtgRate = fxRate ? fxRate.baseRate : 1

    if (!meetsMoncashWithdrawalMinimum(amount, currency, usdToHtgRate)) {
      const minimum = moncashMinimumInfo(currency, usdToHtgRate)
      const htgLabel = `${(MONCASH_MIN_WITHDRAWAL_HTG_CENTS / 100).toLocaleString('en-US')} HTG`
      return NextResponse.json(
        {
          error:
            currency === 'USD'
              ? `The minimum MonCash withdrawal is ${htgLabel} (about ${(minimum.minimumMinor / 100).toFixed(2)} USD at today's rate).`
              : `The minimum MonCash withdrawal is ${htgLabel}.`,
          code: MONCASH_BELOW_MINIMUM_CODE,
          minimum,
        },
        { status: 400 }
      )
    }

    // Owed and unpaid, regardless of timing (cents). WHEN it may leave is the
    // release ladder's decision, made by the gate below.
    const availableBalance = availability.balanceMinor
    if (amount > availableBalance) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${(availableBalance / 100).toFixed(2)} ${currency}` },
        { status: 400 }
      )
    }

    /**
     * The payout release ladder — the same lib/payouts/release-rules.ts decision
     * the Stripe cron makes, applied here because this rail has no cron to gate.
     * It runs BEFORE any reservation, debit or MonCash call, so a refusal moves
     * no money and writes no request. Fed the same gross/refund figures the
     * shared availability computed, so the screen's "available now" and this
     * verdict come from identical inputs.
     */
    const gate = await gateHaitiWithdrawal({
      eventId: String(eventId),
      organizerId: user.id,
      // Server-authoritative end and cancellation, not the editable event doc.
      eventData: gateEventData(eventData, availability),
      grossMinor: availability.gateInputs.grossMinor,
      refundedMinor: availability.gateInputs.refundedMinor,
      currency,
      availableMinor: availableBalance,
      requestedAmountMinor: Number(amount),
      method: 'moncash',
    })

    if (!gate.allowed) {
      return NextResponse.json(gate.body, { status: gate.status })
    }

    // Check if instant MonCash (prefunding) is available and allowed.
    const platformConfigDoc = await adminDb.collection('config').doc('payouts').get()
    const prefunding = platformConfigDoc.exists ? (platformConfigDoc.data() as any)?.prefunding : null
    const prefundingEnabled = Boolean(prefunding?.enabled)
    const prefundingAvailable = Boolean(prefunding?.available)
    const allowInstantMoncash = Boolean(haitiProfile?.allowInstantMoncash)

    const instantPricing = computePrefundedPayout(amount, usdToHtgRate)

    let shouldUsePrefunding = prefundingEnabled && prefundingAvailable && allowInstantMoncash
    let instantFallbackReason: string | null = null

    // The instant rail has no human in the loop, so it is used only when what a
    // human would check is already proven (lib/payouts/instant-moncash-policy):
    // an SMS-verified MonCash number, a wallet name that matches the KYC name,
    // and the shared per-transfer / daily caps. Otherwise: the manual queue.
    const caps = shouldUsePrefunding ? await loadMoncashTransferCaps() : null
    if (shouldUsePrefunding && caps) {
      const [otpVerified, kyc] = await Promise.all([
        moncashNumberOtpVerified(user.id, haitiProfile),
        loadKycLegalNames(user.id),
      ])
      const verdict = decideInstantMoncash({
        otpVerified,
        kyc,
        walletHolderName: haitiProfile.mobileMoneyDetails?.accountName,
        poolDebitHtgCents: instantPricing.poolDebitHtgCents,
        caps,
      })
      if (!verdict.instant) {
        shouldUsePrefunding = false
        instantFallbackReason = verdict.reason
      }
    }

    // The cron refreshes `available` every 15 minutes; the pool can be drained
    // in between. Check it covers THIS transfer plus Digicel's fee, or file the
    // request for the manual queue (fee-free) instead of attempting it.
    if (shouldUsePrefunding && !(await prefundedBalanceCovers(instantPricing.poolDebitHtgCents))) {
      shouldUsePrefunding = false
      instantFallbackReason = 'insufficient_prefunded_balance'
    }

    // A profile saved before full-number fingerprints existed matched on its
    // last 4 digits only: that is not proof it is the same wallet, so the email
    // step-up is required (instant or queued) and the full number is then
    // enrolled as the profile's destination.
    let stepUpUsed = false
    if (destination.via === 'legacy_last4') {
      try {
        await requireRecentPayoutDetailsChangeVerification(user.id)
        stepUpUsed = true
      } catch (e: any) {
        if (String(e?.message || '').includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
          return NextResponse.json(
            {
              error: 'Verification required',
              code: 'PAYOUT_CHANGE_VERIFICATION_REQUIRED',
              requiresVerification: true,
              message:
                'For your security, confirm your MonCash number with the code we email you. You only need to do this once.',
            },
            { status: 403 }
          )
        }
        throw e
      }
      await enrollLegacyMobileMoneyFingerprint(user.id, destination.fingerprint)
    }

    // Pre-create withdrawal request ref so we can use it as MonCash `reference`
    // — which is also what PrefundedTransactionStatus is asked about when the
    // transfer's outcome is unknown.
    const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
    const now = new Date()
    const nowIso = now.toISOString()

    // Built per rail: an instant attempt refused by the daily cap inside its
    // transaction is re-filed on the manual rail (no fee) with the same ref.
    const buildRequest = (instant: boolean) => {
      const feeCents = instant ? instantPricing.feeCents : 0
      const payoutAmountCents = instant ? instantPricing.payoutAmountCents : amount
      const payoutAmountHtgCents = instant
        ? instantPricing.payoutAmountHtgCents
        : Math.max(0, Math.round(amount * usdToHtgRate))
      const row: WithdrawalRequest = {
        organizerId: user.id,
        eventId,
        amount,
        currency,
        method: 'moncash',
        status: instant ? 'processing' : 'pending',
        moncashNumber: receiver,
        feeCents: feeCents || undefined,
        payoutAmountCents: payoutAmountCents || undefined,
        payoutCurrency: 'HTG',
        payoutAmountHtgCents: payoutAmountHtgCents || undefined,
        usdToHtgRateUsed: currency === 'USD' ? usdToHtgRate : undefined,
        usdToHtgRateSource: fxRate?.source,
        usdToHtgRateProvider: fxRate?.provider,
        usdToHtgRateFetchedAt: fxRate?.fetchedAtIso,
        prefundingUsed: instant || undefined,
        prefundingFeePercent: instant ? PREFUNDING_FEE_PERCENT : undefined,
        prefundingProviderFeeHtgCents: instant ? instantPricing.providerFeeHtgCents : undefined,
        prefundingPoolDebitHtgCents: instant ? instantPricing.poolDebitHtgCents : undefined,
        prefundingPlatformNetHtgCents: instant
          ? Math.round(instantPricing.feeCents * usdToHtgRate) - instantPricing.providerFeeHtgCents
          : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      if (instantFallbackReason) (row as any).instantFallbackReason = instantFallbackReason
      // Proof for the admin queue that this number IS the profile's destination
      // (the queue and the admin transfer re-check it against the live profile).
      ;(row as any).destinationFingerprint = destination.fingerprint
      ;(row as any).destinationCheck = destination.via === 'profile' ? 'profile_fingerprint' : 'legacy_last4_step_up'
      return { row, feeCents, payoutAmountCents, payoutAmountHtgCents }
    }

    // Refunds that landed after an earlier event was paid out are organizer
    // debt (lib/payouts/organizer-debt.ts); record them now so the debit below
    // nets them in its own transaction.
    await syncOrganizerDebt(user.id)

    if (shouldUsePrefunding) {
      const { row: baseWithdrawalRequest } = buildRequest(true)
      // For instant prefunding, reserve (debit) earnings first so we never end up
      // transferring money without deducting the organizer's available balance.
      // The transaction serializes concurrent submits on the earnings doc: the
      // second one sees the reduced balance and is refused.
      const { ref: earningsRef } = await getOrCreateEventEarnings(String(eventId), { seedFromTickets: true })
      const dailyRef = adminDb.collection(INSTANT_MONCASH_DAYS_COLLECTION).doc(instantDayKey(now))

      let fellBackToManual = false
      try {
        await adminDb.runTransaction(async (tx: any) => {
          const [earningsSnap, withdrawalSnap, dailySnap] = await Promise.all([
            tx.get(earningsRef),
            tx.get(withdrawalRef),
            tx.get(dailyRef),
          ])
          const debt = await readDebtInTransaction(tx, user.id)

          if (withdrawalSnap.exists) {
            // Defensive: this should not happen since we just created the ref.
            throw new ReservationRefused('Withdrawal request already exists')
          }

          if (!earningsSnap.exists) {
            throw new ReservationRefused('Earnings not found')
          }

          const earningsData = earningsSnap.data() as any
          const withdrawnAmount = Math.max(0, Number(earningsData?.withdrawnAmount || 0) || 0)

          // availability.ceilingMinor was computed outside this transaction; a
          // refund claimed since then lowered it (see readRefundClaimVersion).
          if (refundClaimVersionOf(earningsData) !== expectedRefundClaimVersion) {
            throw new ReservationRefused(REFUND_CLAIMED_RETRY_MESSAGE, REFUND_CLAIMED_RETRY_CODE)
          }

          // Re-checked on the snapshot being debited: validation above read the
          // same row, and must have read it in the same currency.
          if (storedEarningsCurrencyMismatch(earningsData?.currency, eventData?.currency)) {
            throw new ReservationRefused(EARNINGS_CURRENCY_REVIEW_MESSAGE, EARNINGS_CURRENCY_REVIEW_CODE)
          }
          // The shared ceiling (net − legacy batch payouts) minus what THIS
          // snapshot says is already withdrawn: a concurrent submit that debited
          // first is seen here and this one is refused.
          const availableToWithdraw = Math.max(0, availability.ceilingMinor - withdrawnAmount)

          if (availableToWithdraw < amount) {
            throw new ReservationRefused(
              `Insufficient funds. Available: ${(availableToWithdraw / 100).toFixed(2)} ${currency}, Requested: ${(Number(amount) / 100).toFixed(2)} ${currency}`
            )
          }

          // Organizer debt in this currency is repaid from this balance first.
          const netting = netDebtAgainstWithdrawal({
            debt: debt.data,
            currency,
            availableMinor: availableToWithdraw,
            amountMinor: Number(amount),
          })
          if (!netting.ok) throw new ReservationRefused(netting.error, netting.code)

          // Daily instant cap, counted in the transaction that reserves.
          const sentToday = Math.max(0, Number(dailySnap?.exists ? (dailySnap.data() as any)?.totalHtgCents : 0) || 0)
          if (caps && !dailyCapAllows(sentToday, instantPricing.poolDebitHtgCents, caps)) {
            throw new InstantDailyCapReached()
          }

          const debtApplied = netting.appliedMinor
          const remaining = Math.max(0, availableToWithdraw - Number(amount) - debtApplied)
          const newWithdrawn = withdrawnAmount + Number(amount) + debtApplied
          tx.set(
            dailyRef,
            {
              totalHtgCents: sentToday + instantPricing.poolDebitHtgCents,
              count: (Number(dailySnap?.exists ? (dailySnap.data() as any)?.count : 0) || 0) + 1,
              updatedAt: now,
            },
            { merge: true }
          )
          bookDebtRepaymentInTransaction(tx, debt, {
            currency,
            appliedMinor: debtApplied,
            withdrawalId: withdrawalRef.id,
            eventId: String(eventId),
            now,
          })
          if (debtApplied > 0) {
            tx.update(earningsRef, {
              debtAppliedMinor: Math.max(0, Number(earningsData?.debtAppliedMinor) || 0) + debtApplied,
            })
          }

          tx.set(withdrawalRef, {
            ...baseWithdrawalRequest,
            status: 'processing',
            reservedAt: now,
            reservedCents: Number(amount),
            updatedAt: now,
          } satisfies WithdrawalRequest as any)

          tx.update(earningsRef, {
            availableToWithdraw: remaining,
            withdrawnAmount: newWithdrawn,
            settlementStatus: remaining === 0 ? 'locked' : 'ready',
            updatedAt: nowIso,
          })
        })
      } catch (e: any) {
        if (e instanceof InstantDailyCapReached) {
          fellBackToManual = true
        } else if (e instanceof ReservationRefused) {
          return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: 409 })
        } else {
          throw e
        }
      }
      if (fellBackToManual) {
        shouldUsePrefunding = false
        instantFallbackReason = 'daily_instant_cap_reached'
      }
    }

    if (shouldUsePrefunding) {
      const { row: baseWithdrawalRequest, feeCents, payoutAmountCents, payoutAmountHtgCents } = buildRequest(true)
      const outcome = await executePrefundedTransfer({
        amount: Number((payoutAmountHtgCents / 100).toFixed(2)),
        receiver,
        desc: `Tikèm instant withdrawal (${eventId})`,
        reference: withdrawalRef.id,
      })

      if (outcome.outcome === 'completed') {
        const done = await finalizeWithdrawalCompleted(withdrawalRef.id, {
          transactionId: outcome.transactionId,
          raw: outcome.raw,
          confirmedVia: outcome.confirmedVia,
        })
        if (stepUpUsed) await consumePayoutDetailsChangeVerification(user.id)
        if (done.changed) await notifyWithdrawalOutcome(withdrawalRef.id, 'completed', { row: done.row })

        return NextResponse.json({
          success: true,
          withdrawalId: withdrawalRef.id,
          instant: true,
          feeCents,
          payoutAmountCents,
          payoutCurrency: 'HTG',
          payoutAmountHtgCents,
          usdToHtgRateUsed: currency === 'USD' ? usdToHtgRate : null,
          message: 'Instant MonCash withdrawal completed successfully'
        })
      }

      if (outcome.outcome === 'unconfirmed') {
        // The money MAY have moved. Keep the reservation — restoring it would let
        // the organizer withdraw the same money again — and hand it to an admin,
        // who checks MonCash for this reference and completes or fails it.
        console.error('[withdraw-moncash] prefunded transfer outcome unknown; held for reconciliation', {
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
        if (stepUpUsed) await consumePayoutDetailsChangeVerification(user.id)
        await notifyWithdrawalOutcome(withdrawalRef.id, 'confirming', {
          row: { ...baseWithdrawalRequest, status: 'processing', needsReconciliation: true },
        })

        return NextResponse.json(
          {
            success: true,
            withdrawalId: withdrawalRef.id,
            instant: false,
            confirming: true,
            feeCents,
            payoutAmountCents,
            payoutCurrency: 'HTG',
            payoutAmountHtgCents,
            message:
              'Your MonCash withdrawal was sent but not yet confirmed. We are verifying it with MonCash. Do not resubmit.',
          },
          { status: 202 }
        )
      }

      // outcome === 'rejected': MonCash definitively refused, no money moved.
      const failureReason = outcome.reason

      // Give the reservation back — once, in a transaction that refuses unless
      // the row is still 'processing' (the same seam the reconcile cron uses).
      try {
        const released = await releaseWithdrawalReservation(withdrawalRef.id, {
          reason: failureReason,
          releasedBy: 'withdraw_route',
        })
        if (released.changed) await notifyWithdrawalOutcome(withdrawalRef.id, 'failed', { row: released.row })
      } catch (rollbackErr) {
        // The reservation is still held and the row still says 'processing',
        // so it stays visible to an admin (and the reconcile cron) rather than
        // silently losing money.
        console.error('Failed to rollback earnings after prefunded transfer failure:', rollbackErr)
        await withdrawalRef.set(
          {
            needsReconciliation: true,
            reconciliationReason: `rejected by MonCash but rollback failed: ${failureReason}`,
            updatedAt: new Date(),
          },
          { merge: true }
        )
      }

      return NextResponse.json(
        { error: 'Instant MonCash transfer failed', message: failureReason },
        { status: 502 }
      )
    }

    // Standard (manual) MonCash request: filed in the SAME transaction as the
    // debit, so a request exists only if its money was reserved. A refused
    // debit (a concurrent submit already took the balance) writes nothing.
    const { row: baseWithdrawalRequest, payoutAmountHtgCents } = buildRequest(false)
    const debit = await withdrawFromEarnings(eventId, amount, withdrawalRef.id, {
      ceilingMinor: availability.ceilingMinor,
      fileRequest: { ref: withdrawalRef, data: baseWithdrawalRequest as any },
      expectedRefundClaimVersion,
      debt: { organizerId: user.id, currency },
    })
    if (!debit.success) {
      return NextResponse.json(
        { error: debit.error || 'Insufficient balance for this withdrawal', ...(debit.code ? { code: debit.code } : {}) },
        { status: 409 }
      )
    }

    if (stepUpUsed) await consumePayoutDetailsChangeVerification(user.id)
    await notifyWithdrawalOutcome(withdrawalRef.id, 'submitted', { row: baseWithdrawalRequest })

    return NextResponse.json({
      success: true,
      withdrawalId: withdrawalRef.id,
      instant: false,
      instantFallbackReason,
      payoutCurrency: 'HTG',
      payoutAmountHtgCents,
      usdToHtgRateUsed: currency === 'USD' ? usdToHtgRate : null,
      message: 'MonCash withdrawal request submitted successfully'
    })
  } catch (err: any) {
    console.error('MonCash withdrawal error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to process withdrawal' },
      { status: 500 }
    )
  }
}
