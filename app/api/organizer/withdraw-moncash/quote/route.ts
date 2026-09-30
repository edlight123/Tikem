import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getEventEarnings } from '@/lib/earnings'
import { fetchUsdToHtgRate } from '@/lib/currency'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { PREFUNDING_FEE_PERCENT, computePrefundedPayout } from '@/lib/payouts/moncash-prefunded'

const QuerySchema = z.object({
  eventId: z.string().min(1),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const parsed = QuerySchema.safeParse({ eventId: url.searchParams.get('eventId') })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const eventId = parsed.data.eventId

    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const eventData = eventDoc.data() as any
    if (String(eventData?.organizer_id || '') !== String(user.id)) {
      return NextResponse.json({ error: 'Not authorized for this event' }, { status: 403 })
    }

    const earnings = await getEventEarnings(eventId)
    if (!earnings) {
      return NextResponse.json({ error: 'No earnings found for this event' }, { status: 404 })
    }

    const availableToWithdraw =
      earnings.settlementStatus === 'ready'
        ? Math.max(0, Number(earnings.netAmount || 0) - Number(earnings.withdrawnAmount || 0))
        : 0

    const currency = (String(earnings.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG') as 'HTG' | 'USD'

    // Determine whether instant prefunding is available for this organizer.
    const [platformConfigDoc, haitiProfile] = await Promise.all([
      adminDb.collection('config').doc('payouts').get(),
      getPayoutProfile(String(user.id), 'haiti'),
    ])

    const prefunding = platformConfigDoc.exists ? (platformConfigDoc.data() as any)?.prefunding : null
    const prefundingEnabled = Boolean(prefunding?.enabled)
    const prefundingAvailable = Boolean(prefunding?.available)
    const allowInstantMoncash = Boolean(haitiProfile?.allowInstantMoncash)

    const instantAvailable = prefundingEnabled && prefundingAvailable && allowInstantMoncash

    // Same math as the withdrawal itself (lib/payouts/moncash-prefunded.ts), so
    // the fee and net shown here are exactly what the POST charges and sends.
    const usdToHtgRate = currency === 'USD' ? await fetchUsdToHtgRate() : 1
    const instantPricing = computePrefundedPayout(availableToWithdraw, usdToHtgRate)
    const feeCents = instantAvailable ? instantPricing.feeCents : 0
    const payoutAmountCents = instantAvailable ? instantPricing.payoutAmountCents : availableToWithdraw
    const payoutAmountHtgCents = instantAvailable
      ? instantPricing.payoutAmountHtgCents
      : Math.max(0, Math.round(availableToWithdraw * usdToHtgRate))

    return NextResponse.json({
      success: true,
      quote: {
        amountCents: availableToWithdraw,
        currency,
        instantAvailable,
        prefundingFeePercent: instantAvailable ? PREFUNDING_FEE_PERCENT : 0,
        feeCents,
        payoutAmountCents,
        payoutCurrency: 'HTG',
        payoutAmountHtgCents,
        usdToHtgRate: currency === 'USD' ? usdToHtgRate : null,
      },
    })
  } catch (err: any) {
    console.error('withdraw-moncash quote error:', err)
    return NextResponse.json(
      { error: 'Failed to generate MonCash withdrawal quote', message: err?.message || String(err) },
      { status: 500 }
    )
  }
}
