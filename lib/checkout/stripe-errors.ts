/**
 * Turn a Stripe failure into something a buyer can read.
 *
 * Stripe's messages are written for developers and routinely contain internal
 * identifiers — a stale Connect destination surfaces as
 * `No such destination: 'acct_1Sfyt…'`, which was being rendered verbatim in the
 * app's error box. That tells the buyer nothing, looks broken, and leaks an
 * account id. Everything here maps to buyer-facing copy; the real error stays in
 * the server logs where it is useful.
 */

import {
  ORGANIZER_PAYMENTS_UNAVAILABLE,
  ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE,
} from '@/lib/checkout/destination-readiness'

export interface FriendlyError {
  status: number
  /** Stable code for clients that want to branch, e.g. to offer another method. */
  code: string
  message: string
}

const GENERIC: FriendlyError = {
  status: 500,
  code: 'payment_failed',
  message: 'We could not start this payment. Please try again in a moment.',
}

/**
 * The organizer's connected account does not exist on THIS platform account.
 *
 * The common cause is a Connect account issued by a previous platform: the id is
 * still on the payout profile, but the live platform has never seen it. The
 * organizer has to re-onboard — nothing the buyer can do, so the copy points at
 * the organizer rather than blaming the card.
 */
const UNKNOWN_DESTINATION: FriendlyError = {
  status: 409,
  code: ORGANIZER_PAYMENTS_UNAVAILABLE,
  message: ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE,
}

function messageOf(error: any): string {
  return String(error?.raw?.message || error?.message || '')
}

export function friendlyStripeError(error: any): FriendlyError {
  const message = messageOf(error)
  const code = String(error?.raw?.code || error?.code || '')
  const param = String(error?.raw?.param || error?.param || '')

  // Stripe words this several ways depending on the call; match on all of them
  // rather than the exact sentence, which is not part of any contract.
  if (
    /no such destination/i.test(message) ||
    /no such account/i.test(message) ||
    code === 'account_invalid' ||
    param.startsWith('transfer_data')
  ) {
    return UNKNOWN_DESTINATION
  }

  if (code === 'amount_too_small') {
    return {
      status: 400,
      code: 'amount_too_small',
      message: 'This amount is below the minimum a card payment can process.',
    }
  }

  if (code === 'amount_too_large') {
    return {
      status: 400,
      code: 'amount_too_large',
      message: 'This amount is above the maximum a single card payment can process.',
    }
  }

  // A card being declined IS the buyer's business, and Stripe's wording for it is
  // already customer-facing, so it passes through.
  if (error?.type === 'StripeCardError' || code === 'card_declined') {
    return {
      status: 402,
      code: 'card_declined',
      message: message || 'Your card was declined. Please try another card.',
    }
  }

  return GENERIC
}
