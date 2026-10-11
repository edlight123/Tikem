import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  EARNINGS_CURRENCY_REVIEW_CODE,
  EARNINGS_CURRENCY_REVIEW_MESSAGE,
  flagEarningsCurrencyReview,
  readRefundClaimVersion,
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
  NEW_PAYOUT_DESTINATION_HOLD_MS,
  requireRecentPayoutDetailsChangeVerification,
  sameAccountHolderName,
} from '@/lib/firestore/payout'
import type { WithdrawalRequest } from '@/types/earnings'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import { payoutFreezeStatus } from '@/lib/moderation/ban'
import { payoutProfileInactiveReason } from '@/lib/payouts/profile-readiness'
import { holderMatchesKyc, loadKycLegalNames, type KycLegalNames } from '@/lib/payouts/payee-identity'
import { syncOrganizerDebt } from '@/lib/payouts/organizer-debt'
import { notifyWithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'

/** 5,000 minor units of the event's own currency (50.00 HTG / 50.00 USD). */
const BANK_MIN_WITHDRAWAL_MINOR = 5000

/**
 * Is this account holder the organizer? Against the KYC-verified legal (or
 * organization) name with EXACT token matching when Tikèm has one; only a
 * profile approved before KYC names were recorded falls back to the payout
 * profile's own holder name.
 */
function holderIsOrganizer(holder: unknown, kyc: KycLegalNames, profileHolderName: string): boolean {
  if (kyc.verified && (kyc.legalName || kyc.organizationName)) return holderMatchesKyc(holder, kyc)
  return sameAccountHolderName(holder, profileHolderName)
}

/** The bank-proof verification doc ids that judge this destination. */
function bankProofDocIds(destinationId: string): string[] {
  return destinationId === 'bank_primary' ? ['bank_bank_primary', 'bank'] : [`bank_${destinationId}`]
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Banned or admin-frozen: nothing leaves, including earned money.
    const freeze = await payoutFreezeStatus(user.id)
    if (freeze.frozen) {
      return NextResponse.json({ error: freeze.message, message: freeze.message, code: freeze.code }, { status: 403 })
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

    // The REAL reason, not one message for every inactive state.
    const inactive = payoutProfileInactiveReason(haitiProfile, 'bank')
    if (inactive) {
      return NextResponse.json(inactive, { status: 400 })
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
    // saveDestination is no longer needed: a new account is always saved (and held).
    const { eventId, bankDetails, bankDestinationId } = body
    const amount = Number(body?.amount)

    // Validate inputs
    if (!eventId || !amount || (!bankDestinationId && !bankDetails)) {
      return NextResponse.json(
        { error: 'Missing required fields: eventId, amount, bankDetails or bankDestinationId' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be a whole number of cents' }, { status: 400 })
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
    // Recorded BEFORE the ceiling is computed; the debit refuses if a refund
    // claim moved it since (lib/earnings.ts readRefundClaimVersion).
    const expectedRefundClaimVersion = await readRefundClaimVersion(String(eventId))
    const availability = await loadEventAvailability({ eventId: String(eventId), eventData })
    if (!availability) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Minimum: 5,000 minor units OF THE EVENT'S CURRENCY (the earnings screen
    // shows the same floor formatted in that currency). The message used to say
    // "$50.00" for an HTG event whose floor is 50 HTG.
    if (amount < BANK_MIN_WITHDRAWAL_MINOR) {
      return NextResponse.json(
        {
          error: `Minimum withdrawal amount is ${(BANK_MIN_WITHDRAWAL_MINOR / 100).toFixed(2)} ${availability.currency}`,
          code: 'below_minimum',
        },
        { status: 400 }
      )
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
    // Flags for the admin who releases this request by hand.
    const reviewFlags: string[] = []
    const profileHolderName = String((haitiProfile as any)?.bankDetails?.accountName || '')
    const kyc = await loadKycLegalNames(user.id)

    if (bankDestinationId) {
      resolvedDestinationId = String(bankDestinationId)

      // Identity-only + manual review: filing a withdrawal REQUEST does not
      // require the destination to be pre-"verified"; an admin verifies it and
      // releases funds by hand. But a destination added through the new-account
      // path below is held for 24h after it was added (a stolen session plus an
      // email code must not be able to drain to a fresh account immediately).
      const destSnap = await adminDb
        .collection('organizers')
        .doc(user.id)
        .collection('payoutDestinations')
        .doc(resolvedDestinationId)
        .get()
      const holdUntilMs = destSnap.exists ? Date.parse(String((destSnap.data() as any)?.holdUntil || '')) : NaN
      if (Number.isFinite(holdUntilMs) && holdUntilMs > Date.now()) {
        return NextResponse.json(
          {
            error: 'This bank account was added recently. For your security it can receive withdrawals 24 hours after it was added.',
            code: 'PAYOUT_DESTINATION_ON_HOLD',
            availableAt: new Date(holdUntilMs).toISOString(),
          },
          { status: 409 }
        )
      }

      resolvedBankDetails = await getDecryptedBankDestination({
        organizerId: user.id,
        destinationId: resolvedDestinationId,
      })

      if (!resolvedBankDetails) {
        return NextResponse.json({ error: 'Bank destination not found' }, { status: 404 })
      }

      // A destination whose bank proof an admin REJECTED is not payable.
      const proofSnaps = await Promise.all(
        bankProofDocIds(resolvedDestinationId).map((docId) =>
          adminDb.collection('organizers').doc(user.id).collection('verificationDocuments').doc(docId).get()
        )
      )
      const proof = proofSnaps.find((snap: any) => snap?.exists)
      if (proof && String((proof.data() as any)?.status || '') === 'failed') {
        return NextResponse.json(
          {
            error:
              'The bank proof for this account was not approved, so it cannot receive withdrawals. Upload a new proof or choose another account.',
            code: 'BANK_PROOF_REJECTED',
          },
          { status: 409 }
        )
      }

      // The account must be in the organizer's own (KYC-verified) name. This
      // used to only flag the request for the admin; now it refuses.
      if (!holderIsOrganizer(resolvedBankDetails.accountHolder, kyc, profileHolderName)) {
        return NextResponse.json(
          {
            error:
              'The account holder on this bank account does not match your verified legal name, so it cannot receive withdrawals.',
            code: 'PAYOUT_HOLDER_NAME_MISMATCH',
          },
          { status: 409 }
        )
      }
    } else {
      const details = bankDetails as BankDestinationDetails

      if (!details?.accountNumber || !details?.bankName || !details?.accountHolder) {
        return NextResponse.json({ error: 'Incomplete bank details' }, { status: 400 })
      }

      // A new account must be in the organizer's verified name.
      if (!holderIsOrganizer(details.accountHolder, kyc, profileHolderName)) {
        return NextResponse.json(
          {
            error: 'The account holder must match your verified legal name.',
            code: 'PAYOUT_HOLDER_NAME_MISMATCH',
          },
          { status: 400 }
        )
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

      // The new account is SAVED (always) and held for 24 hours, the same hold
      // a payout-settings destination change gets. Nothing is filed now; the
      // organizer withdraws to it once the hold ends.
      const created = await addSecondaryBankDestination({
        organizerId: user.id,
        bankDetails: details,
        addedVia: 'withdraw_bank',
        holdMs: NEW_PAYOUT_DESTINATION_HOLD_MS,
      })
      const holdUntil = created.holdUntil
      await consumePayoutDetailsChangeVerification(user.id)

      return NextResponse.json(
        {
          error:
            'Bank account saved. For your security, a new bank account can receive withdrawals 24 hours after it is added.',
          code: 'PAYOUT_DESTINATION_ON_HOLD',
          bankDestinationId: created.id,
          availableAt: holdUntil,
          saved: true,
        },
        { status: 409 }
      )
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
    if (reviewFlags.length > 0) (withdrawalRequest as any).reviewFlags = reviewFlags

    // Filed in the SAME transaction as the debit (lib/earnings.ts
    // withdrawFromEarnings): a request exists only if its money was reserved,
    // so a refused or failed debit leaves nothing for an admin to pay.
    const withdrawalRef = adminDb.collection('withdrawal_requests').doc()
    // Organizer debt (refunds after an earlier payout) is recorded now and
    // netted inside the debit's transaction, in this currency only.
    await syncOrganizerDebt(user.id)
    const debit = await withdrawFromEarnings(eventId, amount, withdrawalRef.id, {
      ceilingMinor: availability.ceilingMinor,
      fileRequest: { ref: withdrawalRef, data: withdrawalRequest as any },
      expectedRefundClaimVersion,
      debt: { organizerId: user.id, currency },
    })
    if (!debit?.success) {
      const isReview = debit?.code === EARNINGS_CURRENCY_REVIEW_CODE
      return NextResponse.json(
        {
          error: debit?.error || 'Your balance changed. Please refresh and try again.',
          ...(isReview ? { code: EARNINGS_CURRENCY_REVIEW_CODE, needsAdminReview: true } : debit?.code ? { code: debit.code } : {}),
        },
        { status: 409 }
      )
    }

    // Same "request received" notice the MonCash rail sends (deduped, never throws).
    await notifyWithdrawalOutcome(withdrawalRef.id, 'submitted', { row: withdrawalRequest })

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
