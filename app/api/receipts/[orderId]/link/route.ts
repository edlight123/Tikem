/**
 * GET /api/receipts/{orderId}/link: a short-lived signed receipt link for a
 * signed-in buyer of the order (the app opens it in the browser to print or
 * save as PDF). Built on the request's own host (an apex redirect would drop
 * nothing here, but the link should match the host that answered).
 *  200 { url, orderNumber } · 401 · 404 (not a paid order of theirs)
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { loadReceipt } from '@/lib/receipts/receipt-server'
import { receiptPath } from '@/lib/receipts/receipt'
import { receiptLang } from '@/lib/receipts/labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  let orderId = ''
  try {
    orderId = decodeURIComponent(String((await params).orderId || '')).trim()
  } catch {
    orderId = ''
  }
  const loaded = orderId && orderId.length <= 200 ? await loadReceipt(orderId).catch(() => null) : null
  if (!loaded || !loaded.buyerIds.includes(user.id)) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }
  const url = new URL(request.url)
  const lang = receiptLang(url.searchParams.get('lang'))
  return NextResponse.json(
    { url: `${url.origin}${receiptPath(orderId, { signed: true, lang })}`, orderNumber: loaded.model.orderNumber },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
