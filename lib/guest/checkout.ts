// Resolving WHO is checking out, for routes that must serve both an account holder
// and a guest.
//
// Every purchase entry point used to start with `if (!user) return 401`. That single
// line is what dead-ends an Instagram WebView buyer, because the sign-in it points at
// cannot complete there. These helpers replace it with: "a session if there is one,
// otherwise a validated guest contact record" — and nothing else changes. When a
// session exists the returned identity is byte-for-byte the old behavior.

import { consumeRateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'
import { normalizeCountryCode } from '@/lib/payment-provider'
import {
  accessAttemptKey,
  accessCodeMatches,
  clearAccessAttempts,
  grantEventAccess,
  isAccessThrottled,
  recordFailedAccessAttempt,
} from '@/lib/events/access-guard'
import {
  createGuestOrder,
  guestTokenFor,
  isGuestId,
  validateGuestContact,
  type GuestContact,
} from '@/lib/guest/identity'

export interface CheckoutIdentity {
  /** false ⇒ a real Firebase uid; true ⇒ a `guest_…` id with no account. */
  isGuest: boolean
  /** Written to `pending_transactions.user_id` and to `tickets.attendee_id`. */
  id: string
  email: string
  name: string
  phone: string
  /** Raw retrieval token — ONLY present for a guest, and only in the request that mints it. */
  guestToken?: string
  /**
   * The guest order's key. Safe to persist on the order: fulfillment uses it to find
   * the record and to RE-DERIVE the buyer's link, so no bearer credential is stored.
   */
  guestOrderKey?: string
}

export function identityFromUser(user: {
  id: string
  email?: string | null
  full_name?: string | null
  phone_number?: string | null
}): CheckoutIdentity {
  return {
    isGuest: false,
    id: String(user.id),
    email: String(user.email || ''),
    name: String(user.full_name || ''),
    phone: String(user.phone_number || ''),
  }
}

/**
 * Fields to persist on an ORDER (pending transaction / claim) for a guest.
 *
 * These are the authority for who gets the confirmation. Fulfillment reads the
 * recipient from here — never from the body of the confirming request — so a
 * forged callback cannot redirect somebody else's ticket to a new address.
 * They also make the order findable by email or phone for refunds and support.
 */
export function guestOrderFields(identity: CheckoutIdentity): Record<string, any> {
  if (!identity.isGuest) return {}
  return {
    is_guest: true,
    guest_id: identity.id,
    guest_name: identity.name,
    guest_email: identity.email,
    guest_phone: identity.phone || null,
    guest_order_key: identity.guestOrderKey || null,
  }
}

/** The same details, stamped onto each issued ticket so support can search a ticket. */
export function guestTicketFields(identity: CheckoutIdentity): Record<string, any> {
  if (!identity.isGuest) return {}
  return {
    is_guest: true,
    guest_email: identity.email,
    guest_phone: identity.phone || null,
  }
}

/** The buyer of a guest order, as recorded when the order was created. */
export interface GuestOrderRecipient {
  email: string
  name: string
  phone: string
  isGuest: true
  /** Re-derived from the stored order key — the buyer's own retrieval link. */
  guestToken: string | null
}

/**
 * Read the buyer off an ORDER (a pending transaction, or Stripe PaymentIntent
 * metadata mapped to the same field names). Returns null for account purchases, whose
 * recipient still comes from `users/{uid}` exactly as before.
 *
 * This is the ONLY thing fulfillment consults for a guest. The details were captured
 * and stored when checkout began; the confirming request — a gateway redirect, a
 * webhook — contributes nothing but the fact of payment. That is what stops a crafted
 * callback from re-pointing somebody's ticket at a new address.
 */
export function guestRecipientFromOrder(order: any): GuestOrderRecipient | null {
  if (!order) return null
  const isGuest = Boolean(order.is_guest) || isGuestId(order.user_id) || isGuestId(order.guest_id)
  if (!isGuest) return null

  const orderKey = String(order.guest_order_key || '')
  return {
    email: String(order.guest_email || ''),
    name: String(order.guest_name || 'Guest'),
    phone: String(order.guest_phone || ''),
    isGuest: true,
    guestToken: /^[a-f0-9]{48}$/.test(orderKey) ? guestTokenFor(orderKey) : null,
  }
}

export type GuestCheckoutOutcome =
  | { ok: true; identity: CheckoutIdentity }
  | { ok: false; response: NextResponse }

/**
 * Turn the `guest: { name, email, phone }` block of a checkout request into a
 * usable identity, or explain precisely why it can't be used.
 *
 * PASSWORD-PROTECTED EVENTS. A guest used to be refused outright here, because
 * the access grant was keyed by uid and a guest has none — so "sign in instead"
 * was the only safe answer, and inside an Instagram WebView that is a dead end.
 * A guest may now buy by presenting the code with their checkout request:
 *
 *   • the code is checked BEFORE the guest order is created, so a wrong code
 *     leaves nothing behind;
 *   • the check is the same SHA-256 comparison against `events/{id}/private/access`
 *     that the signed-in path uses — a wrong code still fails, and the plaintext
 *     is never stored or logged;
 *   • failures are throttled per IP (a guest has no account to throttle);
 *   • on success the grant is written against the freshly minted `guest_…` id, so
 *     the route's own `hasEventAccess(event, eventId, identity.id)` check passes
 *     for exactly the same reason it passes for a uid.
 */
export async function beginGuestCheckout(params: {
  guestInput: unknown
  event: { country?: string | null; is_password_protected?: boolean } | null
  eventId: string
  ipAddress?: string | null
  /** The access code a guest typed, for a password-protected event. */
  accessCode?: unknown
  /** Shape the error body to the route's own convention. */
  errorBody?: (error: string, code: string) => any
}): Promise<GuestCheckoutOutcome> {
  const body = params.errorBody || ((error: string, code: string) => ({ error, code }))

  // Prove knowledge of the code first: nothing is created for a guest who cannot.
  if (params.event?.is_password_protected) {
    const supplied = String(params.accessCode ?? '').trim()
    if (!supplied) {
      return {
        ok: false,
        response: NextResponse.json(
          body('This event needs an access code.', 'access_code_required'),
          { status: 403 }
        ),
      }
    }

    // Event-wide cap on guest access-code attempts, on top of the per-address
    // throttle below: rotating addresses cannot buy unlimited guesses at one
    // event's code. Generous for real guests; fails closed.
    const eventWide = await consumeRateLimit({
      key: `guest-access-code:event:${params.eventId}`,
      limit: 300,
      windowMs: 60 * 60 * 1000,
    })
    if (eventWide.limited) {
      return {
        ok: false,
        response: NextResponse.json(
          body('Too many attempts. Please try again later.', 'access_throttled'),
          { status: 429 }
        ),
      }
    }

    const attemptKey = accessAttemptKey({ ipAddress: params.ipAddress })
    if (await isAccessThrottled(params.eventId, attemptKey)) {
      return {
        ok: false,
        response: NextResponse.json(
          body('Too many attempts. Please try again later.', 'access_throttled'),
          { status: 429 }
        ),
      }
    }

    if (!(await accessCodeMatches(params.eventId, supplied))) {
      await recordFailedAccessAttempt(params.eventId, attemptKey)
      return {
        ok: false,
        response: NextResponse.json(
          body('Incorrect access code', 'access_code_incorrect'),
          { status: 403 }
        ),
      }
    }
  }

  if (!params.guestInput || typeof params.guestInput !== 'object') {
    return {
      ok: false,
      response: NextResponse.json(body('Unauthorized', 'unauthorized'), { status: 401 }),
    }
  }

  const country = normalizeCountryCode(params.event?.country || undefined)
  const validated = validateGuestContact(params.guestInput, {
    // Haiti: a phone number is how people are actually reachable, so it is required
    // and the ticket also goes out by SMS.
    requirePhone: country === 'HT',
    defaultCountry: country || 'HT',
  })
  if (!validated.ok) {
    return {
      ok: false,
      response: NextResponse.json(body(validated.error, validated.code), { status: 400 }),
    }
  }

  const contact: GuestContact = validated.contact
  const { record, token } = await createGuestOrder({
    contact,
    eventId: params.eventId,
    ipAddress: params.ipAddress,
  })

  // The code was verified above; bind that proof to the id this order will buy
  // under, so the caller's own access check sees a grant like any other.
  if (params.event?.is_password_protected) {
    const attemptKey = accessAttemptKey({ ipAddress: params.ipAddress })
    await grantEventAccess(params.eventId, record.guestId, { isGuest: true })
    await clearAccessAttempts(params.eventId, attemptKey)
  }

  return {
    ok: true,
    identity: {
      isGuest: true,
      id: record.guestId,
      email: record.email,
      name: record.name,
      phone: record.phone,
      guestToken: token,
      guestOrderKey: record.orderKey,
    },
  }
}
