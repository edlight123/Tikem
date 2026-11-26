/**
 * GET /receipts/{orderId}: the printable HTML receipt for one paid order. The
 * buyer saves it as PDF from the print dialog.
 *
 * Access: a signed-in buyer of the order, a Tikèm admin, or a short-lived
 * signed link (?exp=&k=, minted for the buyer by /api/receipts/{orderId}/link
 * so the app can open it in the browser). Anything else is a 404, so order ids
 * cannot be probed.
 *
 * Language: French for a Haiti event (Haiti tickets are French), else ?lang,
 * the site language cookie, then English.
 */
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { loadReceipt } from '@/lib/receipts/receipt-server'
import { renderReceiptHtml, verifyReceiptKey } from '@/lib/receipts/receipt'
import { receiptLangFor } from '@/lib/receipts/labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  let orderId = ''
  try {
    orderId = decodeURIComponent(String((await params).orderId || '')).trim()
  } catch {
    return notFound()
  }
  if (!orderId || orderId.length > 200) return notFound()
  const url = new URL(request.url)

  const keyOk = verifyReceiptKey(orderId, url.searchParams.get('k'), url.searchParams.get('exp'))
  const user = keyOk ? null : await getCurrentUser().catch(() => null)
  if (!keyOk && !user) return notFound()

  const loaded = await loadReceipt(orderId).catch(() => null)
  if (!loaded) return notFound()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  if (!keyOk && !(user && (loaded.buyerIds.includes(user.id) || isAdmin))) return notFound()

  const requested = url.searchParams.get('lang') || (await cookies()).get('i18nextLng')?.value || 'en'
  const html = renderReceiptHtml(loaded.model, receiptLangFor(loaded.model.event, requested))
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
