// Who may confirm a Stripe order and be handed its ticket ids.
//
// /api/tickets/create-from-payment used to answer any caller holding a PaymentIntent id.
// Ids are not secrets (they show up in receipts, logs and support threads), so the
// route now asks for proof of ownership before it returns anything.

import crypto from 'crypto'
import { verifyGuestToken } from '@/lib/guest/identity'

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * - ACCOUNT order: the session uid must equal the uid create-payment-intent stamped on
 *   the PaymentIntent metadata.
 * - GUEST order: the caller presents the PaymentIntent's client_secret (only the paying
 *   browser holds it) or the guest's signed retrieval token for this exact order.
 */
export function callerOwnsPaymentIntent(params: {
  paymentIntent: { client_secret?: string | null; metadata?: Record<string, string> | null }
  user: { id?: string | null } | null
  isGuest: boolean
  clientSecret?: unknown
  guestToken?: unknown
}): boolean {
  const metadata = params.paymentIntent.metadata || {}
  if (!params.isGuest) {
    const owner = String(metadata.userId || '')
    return Boolean(owner && params.user?.id && String(params.user.id) === owner)
  }
  const secret = typeof params.clientSecret === 'string' ? params.clientSecret : ''
  const realSecret = String(params.paymentIntent.client_secret || '')
  if (secret && realSecret && safeEqual(secret, realSecret)) return true
  const orderKey = verifyGuestToken(params.guestToken)
  const piOrderKey = String(metadata.guestOrderKey || '')
  return Boolean(orderKey && piOrderKey && safeEqual(orderKey, piOrderKey))
}
