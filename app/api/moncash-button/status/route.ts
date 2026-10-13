import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { callerHoldsOrder, orderIdsFromCookies } from '@/lib/tickets/orderAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Order status for the /purchase/processing page after a MonCash / NatCash
 * payment whose seats are still being confirmed (fulfillment answered
 * `confirming`: paid, inventory busy, finished by a retry / the reconcile cron).
 *
 * Readable by the browser that started the checkout (it holds the order-proof
 * cookie, so guests work too) or the signed-in buyer. Nothing else is exposed
 * than the status, the ticket id and the failure reason.
 */
export async function GET(request: Request) {
  try {
    const orderId = new URL(request.url).searchParams.get('orderId') || ''
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()
    if (!pendingTx) return NextResponse.json({ status: 'not_found' }, { status: 404 })

    const user = await getCurrentUser().catch(() => null)
    const owns = callerHoldsOrder({
      orderId,
      order: pendingTx,
      cookieOrderIds: orderIdsFromCookies(await cookies()),
      sessionUid: user?.id || null,
    })
    if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json({
      // A paid order handed back for a retry reads 'pending' / 'processing' until it completes.
      status: String(pendingTx.status || 'pending'),
      ticketId: pendingTx.ticket_id || null,
      failureReason: pendingTx.failure_reason || null,
    })
  } catch (error: any) {
    console.error('[moncash_button] status error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
