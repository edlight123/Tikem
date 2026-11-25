import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { getRequest } from '@/lib/doorTeam/requests'
import {
  cancelDoorTeamRequest,
  checkDoorTeamPayment,
  payDoorTeamFromBalance,
  QuoteClosedError,
  startCardDoorTeamPayment,
  startMonCashDoorTeamPayment,
} from '@/lib/doorTeam/payments'
import { CardFxUnavailableError } from '@/lib/platformPay/card'
import { quoteOpen } from '@/lib/doorTeam/rules'

export const dynamic = 'force-dynamic'

/**
 * POST /api/organizer/events/:id/door-team/:requestId
 *
 * { action: 'pay', method: 'moncash' | 'card' | 'balance' }   pay the quote upfront
 * { action: 'check_payment', sessionId? }                     ask MonCash / Stripe
 * { action: 'cancel' }                                        cancel (refund rules in
 *                                                             lib/doorTeam/rules cancelDecision)
 *
 * There is deliberately no way to set or change the price here: only a
 * platform admin quotes (/api/admin/door-team/requests/:id).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id: eventId, requestId } = await params
  const gate = await requireEventAccess(String(eventId || ''), 'manage_events')
  if (!gate.ok) return gate.response
  const { user } = gate.value

  const r = await getRequest(String(requestId || ''))
  if (!r || r.event_id !== eventId) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const body: any = await request.json().catch(() => ({}))
  const action = String(body?.action || '')
  try {
    switch (action) {
      case 'pay': {
        if (r.status !== 'quoted') return NextResponse.json({ error: 'This request is not waiting for payment', code: 'not_payable' }, { status: 409 })
        // A closed quote is never paid at its old price (nor kept alive by a new attempt).
        if (!quoteOpen(r, Date.now())) {
          return NextResponse.json({ error: 'This quote has expired. Ask Tikèm for a new one.', code: 'quote_expired' }, { status: 409 })
        }
        const method = body?.method === 'card' ? 'card' : body?.method === 'balance' ? 'balance' : 'moncash'
        if (method === 'balance') {
          let paid: Awaited<ReturnType<typeof payDoorTeamFromBalance>>
          try {
            paid = await payDoorTeamFromBalance({ request: r, user })
          } catch (err: any) {
            console.error('[door-team] balance payment interrupted', { requestId, message: err?.message })
            return NextResponse.json(
              { error: 'The payment was interrupted. Tap Pay again; you will not be charged twice.', code: 'balance_pending', retryable: true },
              { status: 503 }
            )
          }
          return paid.ok ? NextResponse.json({ paid: true }) : NextResponse.json({ error: paid.error, code: paid.code }, { status: paid.status })
        }
        // Build return URLs on the request's own host (apex → www redirects drop state).
        const origin = new URL(request.url).origin
        try {
          const started = method === 'moncash' ? await startMonCashDoorTeamPayment(r) : await startCardDoorTeamPayment(r, origin)
          return NextResponse.json({ redirectUrl: started.redirectUrl })
        } catch (err: any) {
          if (err instanceof CardFxUnavailableError) return NextResponse.json({ error: err.message, code: 'fx_unavailable' }, { status: 503 })
          if (err instanceof QuoteClosedError) return NextResponse.json({ error: err.message, code: 'quote_expired' }, { status: 409 })
          console.error('[door-team] payment start failed', { requestId, method, message: err?.message })
          return NextResponse.json({ error: 'The payment could not be started. Nothing was charged.', code: 'payment_start_failed' }, { status: 502 })
        }
      }
      case 'check_payment': {
        const res = await checkDoorTeamPayment(r, body?.sessionId ? String(body.sessionId) : null)
        return NextResponse.json(res)
      }
      case 'cancel': {
        const res = await cancelDoorTeamRequest(r, user.id)
        return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error, code: res.code }, { status: res.status })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[door-team] action failed', { requestId, action, message: err?.message })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
