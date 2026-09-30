import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  EARNINGS_CURRENCY_REVIEW_CODE,
  EARNINGS_CURRENCY_REVIEW_MESSAGE,
  flagEarningsCurrencyReview,
  getEventEarnings,
  getOrCreateEventEarnings,
  storedEarningsCurrencyMismatch,
  withdrawFromEarnings,
} from '@/lib/earnings'
import type { WithdrawalRequest } from '@/types/earnings'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'
import {
  consumePayoutDetailsChangeVerification,
  requireRecentPayoutDetailsChangeVerification,
} from '@/lib/firestore/payout'
import { fetchUsdToHtgRate } from '@/lib/currency'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import {
  PREFUNDING_FEE_PERCENT,
  computePrefundedPayout,
  executePrefundedTransfer,
  normalizeMoncashReceiver,
  prefundedBalanceCovers,
  sameMoncashNumberLast4,
} from '@/lib/payouts/moncash-prefunded'
import {
  MONCASH_BELOW_MINIMUM_CODE,
  MONCASH_MIN_WITHDRAWAL_HTG_CENTS,
  meetsMoncashWithdrawalMinimum,
  moncashMinimumInfo,
} from '@/lib/payouts/moncash-withdrawal-minimum'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    if (haitiProfile.status !== 'active') {
      return NextResponse.json(
        {
          error: 'Payout profile not active',
          message: 'Please complete payout verification before requesting MonCash withdrawals.',
        },
        { status: 400 }
      )
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
        { error: 'This event was cancelled — its earnings are reserved for refunds.', code: 'cancelled_event' },
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

    // Verify earnings and settlement status (normalized against event end time)
    const earnings = await getEventEarnings(String(eventId))
    if (!earnings) {
      return NextResponse.json({ error: 'No earnings found for this event' }, { status: 404 })
    }

    // Preserve the event's real currency in the record. This is the Haiti rail
    // (MonCash executes in HTG; USD earnings are converted at withdrawal below).
    // A CAD/EUR event would withdraw via Stripe, not here — but if one reaches
    // this route we must NOT silently rewrite CAD/EUR to HTG.
    const rawCurrency = String(earnings.currency || 'HTG').toUpperCase()
    const currency = (['USD', 'CAD', 'EUR'].includes(rawCurrency) ? rawCurrency : 'HTG') as 'HTG' | 'USD' | 'CAD' | 'EUR'

    // A stored row in another currency than the event's: its figures can be
    // neither validated nor debited safely, so nothing moves until an admin
    // corrects it (lib/earnings.ts storedEarningsCurrencyMismatch).
    if (earnings.withdrawalBlocked?.code === EARNINGS_CURRENCY_REVIEW_CODE) {
      await flagEarningsCurrencyReview(String(eventId), { lastRefusedWithdrawalAt: new Date().toISOString() })
      return NextResponse.json(
        { error: EARNINGS_CURRENCY_REVIEW_MESSAGE, code: EARNINGS_CURRENCY_REVIEW_CODE, needsAdminReview: true },
        { status: 409 }
      )
    }

    // MonCash transfers are executed in HTG. If earnings are in USD, we convert
    // at withdrawal time — and the 1,000 HTG floor is measured on that HTG value.
    const usdToHtgRate = currency === 'USD' ? await fetchUsdToHtgRate() : 1

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

    if (earnings.settlementStatus !== 'ready') {
      return NextResponse.json(
        { error: 'Earnings are not yet available for withdrawal' },
        { status: 400 }
      )
    }

    // Amount comes in cents, availableToWithdraw is also in cents
    const availableBalance = earnings.availableToWithdraw || 0
    if (amount > availableBalance) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${(availableBalance / 100).toFixed(2)} ${currency}` },
        { status: 400 }
      )
    }

    /**
     * The payout release ladder — the same lib/payouts/release-rules.ts decision
     * the Stripe cron makes, applied here because this rail has no cron to gate.
     *
     * `settlementStatus === 'ready'` above is NOT a hold: the Haiti settlement
     * hold is 0 days and an undated event settles off created_at, so it used to
     * clear the moment a draft existed. This is where "not before the event ends,
     * then N hours by tier" is actually enforced, and where a 'review' verdict is
     * routed into the shared admin queue. It runs BEFORE any reservation, debit or
     * MonCash call, so a refusal moves no money and writes no request.
     */
    const gate = await gateHaitiWithdrawal({
      eventId: String(eventId),
      organizerId: user.id,
      eventData,
      grossMinor: Number(earnings.grossSales || 0),
      // A stored event_earnings row is never decremented on refund, so its gross
      // is refund-inclusive and refunds must be subtracted; the tickets-derived
      // view already drops refunded tickets, so subtracting again would under-pay.
      refundedMinor: String((earnings as any).dataSource || 'event_earnings') === 'tickets_derived' ? 0 : null,
      currency: earnings.currency || null,
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

    // The cron refreshes `available` every 15 minutes; the pool can be drained
    // in between. Check it covers THIS transfer plus Digicel's fee, or file the
    // request for the manual queue (fee-free) instead of attempting it.
    if (shouldUsePrefunding && !(await prefundedBalanceCovers(instantPricing.poolDebitHtgCents))) {
      shouldUsePrefunding = false
      instantFallbackReason = 'insufficient_prefunded_balance'
    }

    // An instant transfer is automatic and irreversible — no admin ever looks at
    // it. Sending it to a number other than the one on the payout profile gets
    // the same OTP step-up a new bank account does.
    let stepUpUsed = false
    if (
      shouldUsePrefunding &&
      !sameMoncashNumberLast4(receiver, (haitiProfile as any)?.mobileMoneyDetails?.phoneNumberLast4)
    ) {
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
                'For your security, confirm this MonCash number with the code we email you — it is not the number on your payout profile.',
            },
            { status: 403 }
          )
        }
        throw e
      }
    }

    const feeCents = shouldUsePrefunding ? instantPricing.feeCents : 0
    const payoutAmountCents = shouldUsePrefunding ? instantPricing.payoutAmountCents : amount
    const payoutAmountHtgCents = shouldUsePrefunding
      ? instantPricing.payoutAmountHtgCents
      : Math.max(0, Math.round(amount * usdToHtgRate))

    // Pre-create withdrawal request ref so we can use it as MonCash `reference`
    // — which is also what PrefundedTransactionStatus is asked about when the
    // transfer's outcome is unknown.
    const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
    const now = new Date()
    const nowIso = now.toISOString()

    const baseWithdrawalRequest: WithdrawalRequest = {
      organizerId: user.id,
      eventId,
      amount,
      currency,
      method: 'moncash',
      status: shouldUsePrefunding ? 'processing' : 'pending',
      moncashNumber: receiver,
      feeCents: feeCents || undefined,
      payoutAmountCents: payoutAmountCents || undefined,
      payoutCurrency: 'HTG',
      payoutAmountHtgCents: payoutAmountHtgCents || undefined,
      usdToHtgRateUsed: currency === 'USD' ? usdToHtgRate : undefined,
      prefundingUsed: shouldUsePrefunding || undefined,
      prefundingFeePercent: shouldUsePrefunding ? PREFUNDING_FEE_PERCENT : undefined,
      prefundingProviderFeeHtgCents: shouldUsePrefunding ? instantPricing.providerFeeHtgCents : undefined,
      prefundingPoolDebitHtgCents: shouldUsePrefunding ? instantPricing.poolDebitHtgCents : undefined,
      prefundingPlatformNetHtgCents: shouldUsePrefunding
        ? Math.round(instantPricing.feeCents * usdToHtgRate) - instantPricing.providerFeeHtgCents
        : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    if (instantFallbackReason) (baseWithdrawalRequest as any).instantFallbackReason = instantFallbackReason

    if (shouldUsePrefunding) {
      // For instant prefunding, reserve (debit) earnings first so we never end up
      // transferring money without deducting the organizer's available balance.
      // The transaction serializes concurrent submits on the earnings doc: the
      // second one sees the reduced balance and is refused.
      const { ref: earningsRef } = await getOrCreateEventEarnings(String(eventId))

      try {
        await adminDb.runTransaction(async (tx: any) => {
          const [earningsSnap, withdrawalSnap] = await Promise.all([
            tx.get(earningsRef),
            tx.get(withdrawalRef),
          ])

          if (withdrawalSnap.exists) {
            // Defensive: this should not happen since we just created the ref.
            throw new ReservationRefused('Withdrawal request already exists')
          }

          if (!earningsSnap.exists) {
            throw new ReservationRefused('Earnings not found')
          }

          const earningsData = earningsSnap.data() as any
          const settlementStatus = String(earningsData?.settlementStatus || '')
          const netAmount = Math.max(0, Number(earningsData?.netAmount || 0) || 0)
          const withdrawnAmount = Math.max(0, Number(earningsData?.withdrawnAmount || 0) || 0)

          // Readiness was decided above by getEventEarnings, which normalizes it
          // against the event's end time on READ without persisting it — so a
          // stored 'pending' here is routinely stale. 'locked' (fully withdrawn)
          // is the only stored state that refuses. Availability is recomputed
          // from this snapshot, exactly as withdrawFromEarnings' sync does.
          if (settlementStatus === 'locked') {
            throw new ReservationRefused('Earnings are not yet available for withdrawal')
          }
          // Re-checked on the snapshot being debited: validation above read the
          // same row, and must have read it in the same currency.
          if (storedEarningsCurrencyMismatch(earningsData?.currency, eventData?.currency)) {
            throw new ReservationRefused(EARNINGS_CURRENCY_REVIEW_MESSAGE, EARNINGS_CURRENCY_REVIEW_CODE)
          }
          const availableToWithdraw = Math.max(0, netAmount - withdrawnAmount)

          if (availableToWithdraw < amount) {
            throw new ReservationRefused(
              `Insufficient funds. Available: ${(availableToWithdraw / 100).toFixed(2)} ${currency}, Requested: ${(Number(amount) / 100).toFixed(2)} ${currency}`
            )
          }

          const remaining = Math.max(0, availableToWithdraw - Number(amount))
          const newWithdrawn = withdrawnAmount + Number(amount)

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
        if (e instanceof ReservationRefused) {
          return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: 409 })
        }
        throw e
      }

      const outcome = await executePrefundedTransfer({
        amount: Number((payoutAmountHtgCents / 100).toFixed(2)),
        receiver,
        desc: `Tikèm instant withdrawal (${eventId})`,
        reference: withdrawalRef.id,
      })

      if (outcome.outcome === 'completed') {
        await withdrawalRef.set(
          {
            status: 'completed',
            completedAt: new Date(),
            processedAt: new Date(),
            moncashTransactionId: outcome.transactionId,
            prefundingTransferRaw: outcome.raw,
            confirmedVia: outcome.confirmedVia,
            updatedAt: new Date(),
          },
          { merge: true }
        )
        if (stepUpUsed) await consumePayoutDetailsChangeVerification(user.id)

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
              'Your MonCash withdrawal was sent but not yet confirmed. We are verifying it with MonCash — do not resubmit.',
          },
          { status: 202 }
        )
      }

      // outcome === 'rejected': MonCash definitively refused, no money moved.
      const failureReason = outcome.reason

      // Rollback reserved earnings.
      try {
        await adminDb.runTransaction(async (tx: any) => {
          const [earningsSnap, withdrawalSnap] = await Promise.all([
            tx.get(earningsRef),
            tx.get(withdrawalRef),
          ])

          if (!withdrawalSnap.exists) {
            // Nothing to rollback (should not happen).
            return
          }

          const withdrawal = withdrawalSnap.data() as any
          if (String(withdrawal?.status || '') !== 'processing') {
            // Completed or already rolled back: never credit twice.
            return
          }

          if (!earningsSnap.exists) {
            // Can't safely rollback earnings; still mark withdrawal failed.
            tx.set(
              withdrawalRef,
              {
                status: 'failed',
                failureReason,
                updatedAt: new Date(),
              },
              { merge: true }
            )
            return
          }

          const earningsData = earningsSnap.data() as any
          const availableToWithdraw = Math.max(0, Number(earningsData?.availableToWithdraw || 0) || 0)
          const withdrawnAmount = Math.max(0, Number(earningsData?.withdrawnAmount || 0) || 0)

          const restoredAvailable = availableToWithdraw + Number(amount)
          const restoredWithdrawn = Math.max(0, withdrawnAmount - Number(amount))

          tx.update(earningsRef, {
            availableToWithdraw: restoredAvailable,
            withdrawnAmount: restoredWithdrawn,
            settlementStatus: restoredAvailable === 0 ? 'locked' : 'ready',
            updatedAt: new Date().toISOString(),
          })

          tx.set(
            withdrawalRef,
            {
              status: 'failed',
              failureReason,
              reservationRolledBackAt: new Date(),
              updatedAt: new Date(),
            },
            { merge: true }
          )
        })
      } catch (rollbackErr) {
        // The reservation is still held and the row still says 'processing',
        // so it stays visible to an admin rather than silently losing money.
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

    // Create withdrawal request for manual processing.
    await withdrawalRef.set(baseWithdrawalRequest)

    // Standard (manual) MonCash request. The debit is the real guard: if it is
    // refused (a concurrent submit already took the balance), the request we
    // just filed must not stay 'pending' for an admin to pay out a second time.
    const debit = await withdrawFromEarnings(eventId, amount, withdrawalRef.id)
    if (!debit.success) {
      await withdrawalRef.set(
        { status: 'failed', failureReason: debit.error || 'Earnings debit refused', updatedAt: new Date() },
        { merge: true }
      )
      return NextResponse.json(
        { error: debit.error || 'Insufficient balance for this withdrawal', ...(debit.code ? { code: debit.code } : {}) },
        { status: 409 }
      )
    }

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
