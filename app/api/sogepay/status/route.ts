import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { callerHoldsOrder, orderIdsFromCookies } from '@/lib/tickets/orderAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Polls per IP per window: one page polls every 2.5 s, and a carrier NAT carries many buyers. */
const STATUS_POLLS_PER_IP = 120
const STATUS_WINDOW_MS = 10 * 60 * 1000

/**
 * Lightweight order-status endpoint used by the /purchase/processing page to poll for a
 * Sogepay payment outcome while the server-to-server callback finalizes fulfillment.
 *
 * Readable by the order's own buyer only: the signed-in user who placed it, an admin,
 * or (for a signed-out GUEST) the browser holding the HMAC'd order-proof cookie that
 * /api/sogepay/initiate set. Unknown and not-yours orders both answer 404, so order ids
 * cannot be probed; polling is rate-limited per IP.
 */
export async function GET(request: Request) {
  try {
    const rate = await consumeRateLimit({
      key: `sogepay-status:${clientIp(request)}`,
      limit: STATUS_POLLS_PER_IP,
      windowMs: STATUS_WINDOW_MS,
      failOpen: true,
    })
    if (rate.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }
    const notFound = () => NextResponse.json({ status: 'not_found' }, { status: 404 })

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()

    if (!pendingTx) return notFound()

    const user = await getCurrentUser().catch(() => null)
    const ownsOrder =
      user?.role === 'admin' ||
      callerHoldsOrder({
        orderId,
        order: pendingTx,
        cookieOrderIds: orderIdsFromCookies(await cookies()),
        sessionUid: user?.id || null,
      })
    if (!ownsOrder) return notFound()

    const status = String(pendingTx.status || 'pending')

    return NextResponse.json({
      status, // 'pending' | 'processing' | 'completed' | 'failed'
      ticketId: pendingTx.ticket_id || null,
      failureReason: pendingTx.failure_reason || null,
    })
  } catch (error: any) {
    console.error('[sogepay] status error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
