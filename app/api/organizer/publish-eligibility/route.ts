import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { checkPaidPublishGate } from '@/lib/events/publish-gate'

export const dynamic = 'force-dynamic'

/**
 * Preflight for the publish gate, keyed on the country an organizer is about to
 * publish a PAID event in.
 *
 * This exists for the mobile composer, which creates events by writing to
 * Firestore directly and so never passes through /api/events/[id]/publish. It
 * used to approximate the gate on the client by reading the payout profile and
 * checking that a stripeAccountId was present — which cannot see
 * charges_enabled, and therefore waved through every organizer holding an id
 * from the previous platform account. Asking the server means both clients get
 * the same verdict from the same code.
 *
 * GET /api/organizer/publish-eligibility?country=US
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const country = request.nextUrl.searchParams.get('country')
    if (!country) {
      return NextResponse.json({ error: 'country is required' }, { status: 400 })
    }

    const gate = await checkPaidPublishGate({ organizerId: user.id, country })

    // Always 200: this is a question about eligibility, not an attempt to act.
    // The caller branches on `allowed`.
    return NextResponse.json(
      gate.ok
        ? { allowed: true, warnings: gate.warnings }
        : { allowed: false, code: gate.code, reason: gate.error, retryable: gate.status >= 500 }
    )
  } catch (err: any) {
    console.error('publish-eligibility error:', err)
    return NextResponse.json(
      { error: 'Failed to check publish eligibility', message: err?.message || String(err) },
      { status: 500 }
    )
  }
}
