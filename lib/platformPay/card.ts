/**
 * Charging an organizer on the PLATFORM Stripe account (Tikèm's own revenue:
 * printed tickets, door team). Shared by lib/physical and lib/doorTeam.
 *
 * Prices are in HTG and Stripe has no HTG, so the card is charged USD at the
 * guarded FX rate (lib/fx/usd-htg.ts) with the 'lowest' fallback: a lower
 * HTG-per-USD rate means MORE dollars, never fewer. No trustworthy rate → the
 * card is refused (never a hard-coded rate); MonCash still works.
 *
 * Each Checkout session carries the amount IT asked for in its own metadata
 * (expectedUsdCents), so a session is verified against itself, never against
 * a later re-quote.
 */

export function getPlatformStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

/**
 * USD cents for an HTG amount at an HTG-per-USD rate.
 * Rounded UP, so the platform is never short; 50¢ is Stripe's floor.
 */
export function htgToUsdCentsAtHtgPerUsd(htg: number, htgPerUsd: number): number {
  if (!Number.isFinite(htg) || !Number.isFinite(htgPerUsd) || htgPerUsd <= 0 || htg <= 0) throw new Error('Invalid amount or rate')
  return Math.max(50, Math.ceil((htg / htgPerUsd) * 100 - 1e-9))
}

/** Thrown when no trustworthy USD/HTG rate exists: card is refused, MonCash still works. */
export class CardFxUnavailableError extends Error {
  code = 'fx_unavailable'
  constructor() {
    super('No reliable USD to HTG rate right now. Pay with MonCash, or try card later.')
  }
}

/** Stripe's minimum Checkout lifetime is 30 minutes; a little more for clock skew. */
export const CARD_SESSION_TTL_SECONDS = 31 * 60

/** The USD amount a card is charged for `htg`, from the guarded FX engine. */
export async function cardAmountForHtg(htg: number): Promise<{ amountUsdCents: number; htgPerUsd: number; rateSource: string }> {
  const { getUsdToHtgBaseRate, isFxRateUnavailableError } = await import('@/lib/fx/usd-htg')
  let htgPerUsd: number
  let rateSource: string
  try {
    const r = await getUsdToHtgBaseRate({ fallback: 'lowest' })
    htgPerUsd = r.baseRate
    rateSource = r.source
  } catch (e) {
    if (isFxRateUnavailableError(e)) throw new CardFxUnavailableError()
    throw e
  }
  if (!Number.isFinite(htgPerUsd) || htgPerUsd <= 0) throw new CardFxUnavailableError()
  return { amountUsdCents: htgToUsdCentsAtHtgPerUsd(htg, htgPerUsd), htgPerUsd, rateSource }
}

/** Create a one-line USD Checkout session on the platform account (no Connect destination). */
export async function createPlatformCheckout(params: {
  amountUsdCents: number
  name: string
  description?: string | null
  statementNote: string
  metadata: Record<string, string>
  successUrl: string
  cancelUrl: string
}): Promise<{ sessionId: string; redirectUrl: string; expiresAt: string }> {
  const stripe = getPlatformStripe()
  const expiresAtSec = Math.floor(Date.now() / 1000) + CARD_SESSION_TTL_SECONDS
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    expires_at: expiresAtSec,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: params.amountUsdCents,
          product_data: { name: params.name, description: params.description || undefined },
        },
      },
    ],
    metadata: params.metadata,
    payment_intent_data: { metadata: params.metadata, description: params.statementNote },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  })
  return { sessionId: String(session.id), redirectUrl: String(session.url), expiresAt: new Date(expiresAtSec * 1000).toISOString() }
}

/** Expire a Checkout session if it is still open. Never throws. */
export async function expireOpenCheckoutSession(sessionId: string, logContext: Record<string, unknown> = {}): Promise<void> {
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) return
  try {
    const stripe = getPlatformStripe()
    const old = await stripe.checkout.sessions.retrieve(sessionId)
    if (old?.status === 'open') await stripe.checkout.sessions.expire(sessionId)
  } catch (err: any) {
    console.warn('[platform-pay] could not expire a card session', { ...logContext, message: err?.message })
  }
}

/** Pure: is this Checkout session paid in full for what IT asked for? */
export function cardSessionPaidInFull(session: {
  payment_status?: string
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, any> | null
}): boolean {
  if (session?.payment_status !== 'paid') return false
  const expected = Number(session?.metadata?.expectedUsdCents)
  if (!Number.isFinite(expected) || expected <= 0) return false
  if (String(session?.currency || 'usd').toLowerCase() !== 'usd') return false
  return Number(session?.amount_total) >= expected
}

export async function retrieveCheckoutSession(sessionId: string): Promise<any> {
  return getPlatformStripe().checkout.sessions.retrieve(String(sessionId))
}
