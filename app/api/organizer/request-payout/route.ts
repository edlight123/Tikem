import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import { getPayoutProfile, getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { batchPayoutReserves, gateEventData, integrityRefusal, normalizeCurrencyCode } from '@/lib/payouts/availability'
import {
  EARNINGS_CURRENCY_REVIEW_CODE,
  EARNINGS_CURRENCY_REVIEW_MESSAGE,
  getOrCreateEventEarnings,
  storedEarningsCurrencyMismatch,
} from '@/lib/earnings'
import { FEE_CONFIG } from '@/types/earnings'

/** Shared with the finance page's button gate (EarningsView) — one threshold. */
const MINIMUM_PAYOUT = FEE_CONFIG.MINIMUM_PAYOUT_AMOUNT

/** A refusal raised inside the debit transaction — a 409, not a crash. */
class BatchRefused extends Error {}

/**
 * Batch payout request (finance page "Request payout").
 *
 * Pays, in ONE currency, every event whose money the shared availability
 * function (lib/payouts/availability.ts) says is released right now — the same
 * figure the finance page shows and the per-event withdraw routes validate. It
 * used to run its own engine (flat uncapped 10%, a 7-day delay, Invalid Date on
 * Timestamp end dates, HTG and USD summed into one number) and never debited
 * the per-event ledger, so an event paid here could be withdrawn again through
 * MonCash.
 *
 * Now, atomically, it debits each event's event_earnings.withdrawnAmount (the
 * ledger every payout path shares) and records the payout with its ticketIds
 * (idempotency), its per-event amounts, and `debitedEventEarnings: true`.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const organizerId = decodedClaims.uid

    const body = await request.json().catch(() => ({}))
    const requestedCurrency = body?.currency ? normalizeCurrencyCode(body.currency) : null

    // IDEMPOTENCY CHECK 1: one open request at a time. `approved` is open too —
    // it used to be missed here, so a second request could be filed beside it.
    const payoutsCol = adminDb.collection('organizers').doc(organizerId).collection('payouts')
    const existingSnap = await payoutsCol.get()
    const open = existingSnap.docs.find((d: any) => {
      const st = String(d.data()?.status || 'pending').toLowerCase()
      return batchPayoutReserves(st) && st !== 'completed'
    })
    if (open) {
      const existingPayout = open.data()
      return NextResponse.json(
        {
          error: 'Payout already in progress',
          message: `You have a ${existingPayout.status} payout request for ${(Number(existingPayout.amount || 0) / 100).toFixed(2)} ${existingPayout.currency || 'HTG'}. Please wait for it to be processed.`,
          existingPayoutId: open.id,
        },
        { status: 400 }
      )
    }

    // The ONE availability figure, per event.
    const { events, context } = await loadOrganizerAvailability(organizerId)

    // Integrity holds refuse the WHOLE request, explicitly — the same refusals
    // the per-event MonCash/bank routes give. The shared function already
    // reports 0 available for such an event, so it could never be paid here;
    // refusing (rather than quietly batching the organizer's other events)
    // keeps the flagged event in front of the payouts team.
    for (const e of events) {
      if (getRequiredPayoutProfileIdForEventCountry(e.country) !== 'haiti') continue
      if (e.reason === EARNINGS_CURRENCY_REVIEW_CODE) {
        return NextResponse.json(
          { error: EARNINGS_CURRENCY_REVIEW_MESSAGE, code: EARNINGS_CURRENCY_REVIEW_CODE, needsAdminReview: true, eventId: e.eventId },
          { status: 409 }
        )
      }
      const integrity = integrityRefusal(e)
      if (integrity) {
        return NextResponse.json({ ...integrity.body, eventId: e.eventId }, { status: integrity.status })
      }
    }

    // This is the Haiti rail (MonCash / Haitian bank). Stripe Connect markets
    // are paid by Stripe and never batched here.
    const eligible = events.filter(
      (e) => e.availableNowMinor > 0 && getRequiredPayoutProfileIdForEventCountry(e.country) === 'haiti'
    )
    const currencies = Array.from(new Set(eligible.map((e) => e.currency)))
    const currency = requestedCurrency || (currencies.length === 1 ? currencies[0] : null)

    if (!currency && currencies.length > 1) {
      return NextResponse.json(
        {
          error: 'Choose a currency',
          code: 'currency_required',
          message: `You have released funds in ${currencies.join(' and ')}. Request each currency separately.`,
          currencies,
        },
        { status: 400 }
      )
    }

    const batch = eligible.filter((e) => e.currency === currency)
    const totalAmount = batch.reduce((sum, e) => sum + e.availableNowMinor, 0)
    const label = currency || 'HTG'

    if (totalAmount < MINIMUM_PAYOUT) {
      return NextResponse.json(
        {
          error: 'Insufficient balance',
          message: `Minimum payout amount is ${(MINIMUM_PAYOUT / 100).toFixed(2)} ${label}. Current available balance: ${(totalAmount / 100).toFixed(2)} ${label}`,
        },
        { status: 400 }
      )
    }

    const haitiProfile = await getPayoutProfile(organizerId, 'haiti')

    if (!haitiProfile) {
      return NextResponse.json({ error: 'Payout method not configured' }, { status: 400 })
    }

    if (haitiProfile.status !== 'active') {
      return NextResponse.json(
        {
          error: 'Payout account not active',
          message: 'Please complete verification before requesting a payout',
        },
        { status: 400 }
      )
    }

    /**
     * The payout release ladder, per contributing event, unchanged: the whole
     * batch is refused if any one event is not releasable (it does not quietly
     * drop the event and pay less — the recorded set must be the set judged).
     * Fed the same inputs the shared availability used.
     */
    for (const e of batch) {
      const gate = await gateHaitiWithdrawal({
        eventId: e.eventId,
        organizerId,
        eventData: gateEventData(e.eventData, e),
        grossMinor: e.gateInputs.grossMinor,
        refundedMinor: e.gateInputs.refundedMinor,
        currency: e.currency,
        availableMinor: e.balanceMinor,
        requestedAmountMinor: e.availableNowMinor,
        method: 'batch',
        context: context.releaseContext,
      })
      if (!gate.allowed) {
        return NextResponse.json({ ...gate.body, eventId: e.eventId }, { status: gate.status })
      }
    }

    // Calculate next Friday at 5:00 PM (batched payout schedule)
    const now = new Date()
    const nextFriday = new Date(now)
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7
    nextFriday.setDate(now.getDate() + daysUntilFriday)
    nextFriday.setHours(17, 0, 0, 0)

    // IDEMPOTENCY SAFEGUARD: the ticket ids this payout covers.
    const ticketIds = Array.from(new Set(batch.flatMap((e) => e.unpaidTicketIds)))
    const starts = batch.map((e) => e.periodStart).filter(Boolean) as string[]
    const ends = batch.map((e) => e.periodEnd).filter(Boolean) as string[]
    const periodStart = starts.length ? starts.sort()[0] : null
    const periodEnd = ends.length ? ends.sort()[ends.length - 1] : null
    const eventAmounts: Record<string, number> = {}
    for (const e of batch) eventAmounts[e.eventId] = e.availableNowMinor

    // Ledger rows to debit (created, seeded from tickets, if missing).
    const ledgerRefs = await Promise.all(
      batch.map(async (e) => ({ e, ref: (await getOrCreateEventEarnings(e.eventId, { seedFromTickets: true })).ref }))
    )

    const payoutRef = payoutsCol.doc()
    const payout = {
      organizerId,
      amount: totalAmount,
      status: 'pending',
      method: haitiProfile.method,
      scheduledDate: nextFriday.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      requestedBy: organizerId,
      ticketIds,
      eventAmounts,
      debitedEventEarnings: true,
      periodStart,
      periodEnd,
      currency: label,
    }

    try {
      await adminDb.runTransaction(async (tx: any) => {
        const snaps = await Promise.all(ledgerRefs.map(({ ref }) => tx.get(ref)))
        // Every read before any write (Firestore transaction rule).
        snaps.forEach((snap: any, i: number) => {
          const { e } = ledgerRefs[i]
          const cur = snap.exists ? (snap.data() as any) : {}
          if (storedEarningsCurrencyMismatch(cur?.currency, e.eventData?.currency)) {
            throw new BatchRefused(`Earnings for "${e.title}" need a review by the payouts team before they can be paid.`)
          }
          const withdrawn = Math.max(0, Number(cur?.withdrawnAmount || 0) || 0)
          if (Math.max(0, e.ceilingMinor - withdrawn) < e.availableNowMinor) {
            throw new BatchRefused('Your balance changed while this request was being made. Please refresh and try again.')
          }
        })
        snaps.forEach((snap: any, i: number) => {
          const { e, ref } = ledgerRefs[i]
          const cur = snap.exists ? (snap.data() as any) : {}
          const withdrawn = Math.max(0, Number(cur?.withdrawnAmount || 0) || 0)
          const remaining = Math.max(0, e.ceilingMinor - withdrawn - e.availableNowMinor)
          tx.update(ref, {
            withdrawnAmount: withdrawn + e.availableNowMinor,
            availableToWithdraw: remaining,
            settlementStatus: remaining === 0 ? 'locked' : 'ready',
            updatedAt: now.toISOString(),
          })
        })
        tx.set(payoutRef, payout)
      })
    } catch (e: any) {
      if (e instanceof BatchRefused) {
        return NextResponse.json({ error: e.message }, { status: 409 })
      }
      throw e
    }

    return NextResponse.json({
      success: true,
      payout: {
        id: payoutRef.id,
        ...payout,
        ticketCount: ticketIds.length,
      },
    })
  } catch (error: any) {
    console.error('Error requesting payout:', error)
    return NextResponse.json(
      { error: 'Failed to request payout', message: error.message },
      { status: 500 }
    )
  }
}
