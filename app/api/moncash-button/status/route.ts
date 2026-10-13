import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { consumeRateLimit } from '@/lib/rate-limit'
import { callerHoldsOrder, orderIdsFromCookies } from '@/lib/tickets/orderAccess'
import { clientIpOf, isValidOrderStatusToken } from '@/lib/tickets/seatHolds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Polls per IP per window: one page polls every 2.5 s, and a carrier NAT carries many buyers. */
const STATUS_POLLS_PER_IP = 120
const STATUS_WINDOW_MS = 10 * 60 * 1000

/**
 * Order status for the /purchase/processing page after a MonCash / NatCash
 * payment whose seats are still being confirmed (fulfillment answered
 * `confirming`: paid, inventory busy, finished by a retry / the reconcile cron).
 *
 * Readable with any of: the signed short-lived status token in the processing
 * page URL (`st`, for the app's WebView, which never saw the order cookie), the
 * order-proof cookie of the browser that started the checkout, or the signed-in
 * buyer's session. Unknown and not-yours orders both answer 404, so order ids
 * cannot be probed; polling is rate-limited per IP.
 */
export async function GET(request: Request) {
  try {
    const ip = clientIpOf(request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'))
    const rate = await consumeRateLimit({
      key: `moncash-status:${ip || 'unknown'}`,
      limit: STATUS_POLLS_PER_IP,
      windowMs: STATUS_WINDOW_MS,
      failOpen: true,
    })
    if (rate.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

    const url = new URL(request.url)
    const orderId = url.searchParams.get('orderId') || ''
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    const notFound = () => NextResponse.json({ status: 'not_found' }, { status: 404 })

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()
    if (!pendingTx) return notFound()

    // Two levels of access. The order cookie or the signed-in buyer OWNS the
    // order and may see its ticket id, exactly as on the return route. The
    // signed status token (`st`) rides in a redirect URL, so it is handed to
    // whoever followed that link (the app's MonCash WebView has no cookie): it
    // proves no more than the order id itself did, and so it reads the STATUS
    // only, never the ticket id.
    const ownsOrder = callerHoldsOrder({
      orderId,
      order: pendingTx,
      cookieOrderIds: orderIdsFromCookies(await cookies()),
      sessionUid: (await getCurrentUser().catch(() => null))?.id || null,
    })
    if (!ownsOrder && !isValidOrderStatusToken(orderId, url.searchParams.get('st'))) return notFound()

    return NextResponse.json({
      // A paid order handed back for a retry reads 'pending' / 'processing' until it completes.
      status: String(pendingTx.status || 'pending'),
      ticketId: ownsOrder ? pendingTx.ticket_id || null : null,
      failureReason: pendingTx.failure_reason || null,
    })
  } catch (error: any) {
    console.error('[moncash_button] status error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
