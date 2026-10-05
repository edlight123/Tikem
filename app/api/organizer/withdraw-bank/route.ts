import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  EARNINGS_CURRENCY_REVIEW_CODE,
  EARNINGS_CURRENCY_REVIEW_MESSAGE,
  flagEarningsCurrencyReview,
  withdrawFromEarnings,
} from '@/lib/earnings'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { gateEventData, integrityRefusal } from '@/lib/payouts/availability'
import {
  addSecondaryBankDestination,
  getDecryptedBankDestination,
  type BankDestinationDetails,
} from '@/lib/firestore/payout-destinations'
import {
  consumePayoutDetailsChangeVerification,
  requireRecentPayoutDetailsChangeVerification,
} from '@/lib/firestore/payout'
import type { WithdrawalRequest } from '@/types/earnings'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'

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
          message: 'Bank withdrawals are only available for organizers with a Haiti payout profile.',
        },
        { status: 400 }
      )
    }

    if (haitiProfile.status !== 'active') {
      return NextResponse.json(
        {
          error: 'Payout profile not active',
          message: 'Please complete payout verification before requesting bank withdrawals.',
        },
        { status: 400 }
      )
    }

    if (haitiProfile.method !== 'bank_transfer') {
      return NextResponse.json(
        {
          error: 'Bank transfer not configured',
          message: 'Please configure Haiti payout method as Bank transfer to withdraw to a bank account.',
        },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { eventId, amount, bankDetails, bankDestinationId, saveDestination } = body

    // Validate inputs
    if (!eventId || !amount || (!bankDestinationId && !bankDetails)) {
      return NextResponse.json(
        { error: 'Missing required fields: eventId, amount, bankDetails or bankDestinationId' },
        { status: 400 }
      )
    }

    // Minimum withdrawal amount (in cents)
    if (amount < 5000) {
      return NextResponse.json(
        { error: 'Minimum withdrawal amount is $50.00' },
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
          message: 'US/Canada events must withdraw via Stripe Connect. Bank withdrawals are not available for this event.',
        },
        { status: 400 }
      )
    }

    // What this event can pay out — the one shared figure
    // (lib/payouts/availability.ts), the same number the earnings screens show.
    const availability = await loadEventAvailability({ eventId: String(eventId), eventData })
    if (!availability) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Same refusal as the MonCash route: a stored row in another currency than
    // the event's reads as 0 available, which would otherwise surface as a
    // misleading "Insufficient balance".
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

    // Owed and unpaid, in cents, regardless of timing; the gate below decides when.
    const availableBalance = availability.balanceMinor
    if (amount > availableBalance) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${(availableBalance / 100).toFixed(2)} ${availability.currency}` },
        { status: 400 }
      )
    }

    /**
     * The payout release ladder — the same lib/payouts/release-rules.ts decision
     * the Stripe cron makes, applied here because this rail has no cron to gate.
     *
     * This is where "not before the event ends, then N hours by tier" is
     * enforced, and where a 'review' verdict is routed into the shared admin
     * queue. Fed the same gross/refund figures the shared availability used.
     *
     * It deliberately runs BEFORE the bank-destination block below, which both
     * writes (a saved destination) and consumes a one-time email code. Refusing
     * after that would burn the organizer's OTP on a withdrawal that was never
     * going to be filed.
     */
    const gate = await gateHaitiWithdrawal({
      eventId: String(eventId),
      organizerId: user.id,
      // Server-authoritative end and cancellation, not the editable event doc.
      eventData: gateEventData(eventData, availability),
      grossMinor: availability.gateInputs.grossMinor,
      refundedMinor: availability.gateInputs.refundedMinor,
      currency: availability.currency,
      availableMinor: availableBalance,
      requestedAmountMinor: Number(amount),
      method: 'bank',
    })

    if (!gate.allowed) {
      return NextResponse.json(gate.body, { status: gate.status })
    }

    // Bank destination resolution. Deliberately AFTER every read-only guard above
    // (ownership, cancellation, routing, settlement, balance, release ladder),
    // because this block writes a saved destination and consumes the one-time
    // email code for a new account.
    let resolvedBankDetails: BankDestinationDetails | null = null
    let resolvedDestinationId: string | null = null

    if (bankDestinationId) {
      resolvedDestinationId = String(bankDestinationId)

      // Identity-only + manual review: filing a withdrawal REQUEST no longer
      // requires the specific bank destination to be pre-"verified". No money
      // moves here — this only creates a `pending` withdrawal_request. An admin
      // verifies the destination and releases funds by hand, which is the actual
      // gate. (The profile still had to reach `active` via identity verification
      // upstream, and the destination must still exist — enforced by the 404
      // below.)
      resolvedBankDetails = await getDecryptedBankDestination({
        organizerId: user.id,
        destinationId: resolvedDestinationId,
      })

      if (!resolvedBankDetails) {
        return NextResponse.json({ error: 'Bank destination not found' }, { status: 404 })
      }
    } else {
      resolvedBankDetails = bankDetails as BankDestinationDetails

      if (!resolvedBankDetails?.accountNumber || !resolvedBankDetails?.bankName || !resolvedBankDetails?.accountHolder) {
        return NextResponse.json({ error: 'Incomplete bank details' }, { status: 400 })
      }

      // Using a new bank account requires OTP step-up.
      try {
        await requireRecentPayoutDetailsChangeVerification(user.id)
      } catch (e: any) {
        const message = String(e?.message || '')
        if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
          return NextResponse.json(
            {
              error: 'Verification required',
              code: 'PAYOUT_CHANGE_VERIFICATION_REQUIRED',
              requiresVerification: true,
              message:
                'For your security, confirm this new bank account with the code we email you before using it for withdrawals.',
            },
            { status: 403 }
          )
        }
        throw e
      }

      // Optionally save as a second account.
      if (saveDestination) {
        const created = await addSecondaryBankDestination({ organizerId: user.id, bankDetails: resolvedBankDetails })
        resolvedDestinationId = created.id
      }

      await consumePayoutDetailsChangeVerification(user.id)
    }

    // Create withdrawal request. Preserve the event's real currency in the record;
    // a CAD/EUR event would withdraw via Stripe (not this Haiti bank rail), so never
    // silently rewrite CAD/EUR to HTG.
    const currency = availability.currency

    const accountNumber = String(resolvedBankDetails.accountNumber)
    const maskedAccountNumber = accountNumber.length > 4 ? `****${accountNumber.slice(-4)}` : accountNumber

    const withdrawalRequest: WithdrawalRequest = {
      organizerId: user.id,
      eventId,
      amount,
      currency,
      method: 'bank',
      status: 'pending',
      bankDetails: {
        // Avoid storing full bank account number when it is saved as a destination.
        accountNumber: resolvedDestinationId ? maskedAccountNumber : accountNumber,
        bankName: String(resolvedBankDetails.bankName),
        accountHolder: String(resolvedBankDetails.accountHolder),
        swiftCode: resolvedBankDetails.swiftCode,
        routingNumber: resolvedBankDetails.routingNumber,
      },
      bankDestinationId: resolvedDestinationId || undefined,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    // Filed in the SAME transaction as the debit (lib/earnings.ts
    // withdrawFromEarnings): a request exists only if its money was reserved,
    // so a refused or failed debit leaves nothing for an admin to pay.
    const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
    const debit = await withdrawFromEarnings(eventId, amount, withdrawalRef.id, {
      ceilingMinor: availability.ceilingMinor,
      fileRequest: { ref: withdrawalRef, data: withdrawalRequest as any },
    })
    if (!debit?.success) {
      const isReview = debit?.code === EARNINGS_CURRENCY_REVIEW_CODE
      return NextResponse.json(
        {
          error: debit?.error || 'Your balance changed. Please refresh and try again.',
          ...(isReview ? { code: EARNINGS_CURRENCY_REVIEW_CODE, needsAdminReview: true } : {}),
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      withdrawalId: withdrawalRef.id,
      message: 'Bank transfer withdrawal request submitted successfully'
    })
  } catch (err: any) {
    console.error('Bank withdrawal error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to process withdrawal' },
      { status: 500 }
    )
  }
}
