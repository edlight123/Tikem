import { setOrderProofCookies } from '@/lib/tickets/orderAccess'
import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import {
  buildTokenVariants,
  createMonCashButtonCheckoutFormPost,
  isMonCashButtonConfigured,
} from '@/lib/moncash-button'
import {
  createMonCashGatewayPayment,
  isMonCashConfigured,
  prewarmMonCashAccessToken,
} from '@/lib/moncash'
import { verifyGuestToken } from '@/lib/guest/identity'
import crypto from 'crypto'

export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

/**
 * Starts a mobile-money checkout.
 *
 * - MonCash: standard REST gateway flow — CreatePayment -> 303 redirect to the
 *   hosted MonCash payment page (/Moncash-business/Payment/Redirect). The customer
 *   pays on MonCash, then MonCash returns them to our ReturnUrl (handled by
 *   /api/moncash-button/return), which verifies via RetrieveOrderPayment.
 * - NatCash: unchanged form-POST "Hosted Page" flow.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const orderId = url.searchParams.get('orderId') || ''
    if (!orderId) {
      return new NextResponse('Missing orderId', { status: 400 })
    }

    // Latency: this route sits between the buyer tapping Pay and the MonCash page
    // appearing, and used to run strictly in sequence — session check, order read,
    // Digicel OAuth, CreatePayment, order write — before redirecting. The OAuth
    // token and the order read do not depend on the session, so they start now and
    // overlap with it. Authorization below is unchanged: nothing is returned or
    // charged until the session (or guest token) has been checked against the order.
    void prewarmMonCashAccessToken()
    const supabase = await createClient()
    // Promise.resolve() runs the (lazy, re-executing) query builder exactly once
    // and gives us a real promise to await later.
    const pendingRead = Promise.resolve(
      supabase.from('pending_transactions').select('*').eq('order_id', orderId).single()
    )
    // Never leave a rejected read unobserved if we return early on auth.
    pendingRead.catch(() => {})

    const user = await getCurrentUser()

    // A GUEST has no session to prove this order is theirs, so the initiate route
    // appended their signed retrieval token to this URL. Verifying it here (and
    // matching it against the order's own key below) is the same capability check a
    // session performs — an order id alone is never enough to start someone's payment.
    const guestOrderKeyFromLink = verifyGuestToken(url.searchParams.get('g'))
    if (!user && !guestOrderKeyFromLink) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const orderHash = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 10)

    const { data: pending, error } = await pendingRead

    if (error || !pending) {
      return new NextResponse('Pending transaction not found', { status: 404 })
    }

    const ownsOrder = user
      ? pending.user_id === user.id
      : Boolean(
          guestOrderKeyFromLink &&
            pending.guest_order_key &&
            String(pending.guest_order_key) === guestOrderKeyFromLink
        )
    if (!ownsOrder) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // Only a still-PENDING order may start a payment. Re-opening this link on a
    // completed (or processing, failed, refund-flagged) order used to create a FRESH
    // gateway payment for it — a second charge for tickets already issued.
    if (String(pending.status || '').toLowerCase() !== 'pending' || pending.needs_refund === true) {
      console.warn('[moncash_button] checkout: refusing to start payment for a non-pending order', {
        orderHash,
        status: pending.status,
      })
      return new NextResponse('This order can no longer be paid. Please start a new checkout.', {
        status: 409,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    const provider = String(pending.mobile_money_provider || pending.payment_method || 'moncash').toLowerCase()
    const amount = Number(pending.amount) || 0

    // Correlation cookies so the (cross-site) Return URL can map back to this order,
    // even if cookies are dropped on the round trip. Set on this top-level navigation.
    const setCorrelationCookies = (response: NextResponse) => {
      const cookieOpts = {
        httpOnly: true as const,
        sameSite: 'none' as const,
        secure: true as const,
        path: '/',
        maxAge: 60 * 60,
      }
      response.cookies.set('moncash_button_order_id', orderId, cookieOpts)
      response.cookies.set('__Host-moncash_button_order_id', orderId, cookieOpts)

      // Also set a domain cookie to survive www <-> apex ReturnUrl mismatches.
      // (A __Host- cookie cannot set Domain.)
      const host = new URL(request.url).hostname
      const apex = host.startsWith('www.') ? host.slice(4) : host
      if (apex && apex.includes('.') && !/localhost/i.test(apex) && !/vercel\.app$/i.test(apex)) {
        response.cookies.set('moncash_button_order_id_domain', orderId, { ...cookieOpts, domain: `.${apex}` })
      }
      setOrderProofCookies(response, orderId, request.url)
    }

    // --- MonCash: standard REST gateway flow (CreatePayment -> redirect) ---
    if (provider !== 'natcash') {
      if (!isMonCashConfigured()) {
        return new NextResponse('MonCash is not configured', { status: 500 })
      }

      const { redirectUrl, token, expiresAt } = await createMonCashGatewayPayment({ amount, orderId })
      console.info('[moncash_button] checkout: redirecting to MonCash gateway', { orderHash, amount })

      // Persist the gateway token so the Return handler can correlate back to this order
      // even if cookies are dropped on the cross-site round trip. (Best effort.)
      //
      // The variants matter: Digicel hands the token back re-encoded (base64 vs
      // base64url, padding stripped), and the Return handler looks the order up by
      // `moncash_button_token_variants`. Writing only the raw token left that
      // fallback permanently empty on this rail.
      //
      // Written AFTER the redirect is sent (after() keeps the function alive until it
      // lands) so the buyer is not held on a Firestore round trip. The Return handler
      // only needs it once the buyer has finished paying on MonCash's page.
      after(async () => {
        try {
          await supabase
            .from('pending_transactions')
            .update({
              moncash_button_token: token,
              moncash_button_token_variants: buildTokenVariants(token),
              moncash_token_expires_at: expiresAt,
            })
            .eq('order_id', orderId)
        } catch {
          /* non-fatal */
        }
      })

      const response = NextResponse.redirect(redirectUrl, 303)
      response.headers.set('Cache-Control', 'no-store')
      setCorrelationCookies(response)
      return response
    }

    // --- NatCash: unchanged form-POST "Hosted Page" flow ---
    if (!isMonCashButtonConfigured()) {
      return new NextResponse('MonCash Button is not configured', { status: 500 })
    }
    console.info('[moncash_button] checkout: serving FORM POST page (natcash)', { orderHash })

    const { actionUrl, fields, meta } = createMonCashButtonCheckoutFormPost({
      amount,
      orderId,
    })

    console.info('[moncash_button] checkout: form meta', {
      orderHash,
      mode: meta.mode,
      paddingMode: meta.paddingMode,
      ciphertextEncoding: meta.ciphertextEncoding,
      amountPlaintext: meta.amountPlaintext,
      businessKeySegmentKind: meta.businessKeySegmentKind,
      businessKeySegmentHash: meta.businessKeySegmentHash,
    })

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redirecting to NatCash…</title>
</head>
<body>
  <form id="moncashForm" method="post" action="${actionUrl}">
    <input type="hidden" name="amount" value="${fields.amount}" />
    <input type="hidden" name="orderId" value="${fields.orderId}" />
    <noscript>
      <p>JavaScript is required to continue. Click the button below.</p>
      <button type="submit">Continue</button>
    </noscript>
  </form>
  <script>
    document.getElementById('moncashForm').submit();
  </script>
</body>
</html>`

    const response = new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
    setCorrelationCookies(response)
    return response
  } catch (err: any) {
    console.error('MonCash Button checkout error:', err)
    return new NextResponse('Failed to start checkout', { status: 500 })
  }
}
