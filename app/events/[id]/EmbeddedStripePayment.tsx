'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useRouter } from 'next/navigation'
import { X, CreditCard, Lock } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useTranslation } from 'react-i18next'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import type { Attribution } from '@/lib/attribution'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

/** The seats the server holds for this checkout (lib/tickets/seatHolds.ts). */
interface SeatHold {
  id: string
  expiresAt: string
  releaseToken: string
}

/** "Seats held for 7:42", ticking down; the expiry note once the hold runs out. */
function SeatHoldCountdown({ expiresAt, t }: { expiresAt: string; t: (key: string, opts?: any) => string }) {
  const end = new Date(expiresAt).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!Number.isFinite(end)) return null
  const left = Math.max(0, Math.floor((end - now) / 1000))
  if (left <= 0) {
    return <p className="mb-4 text-center text-xs text-white/60">{t('checkout.seat_hold_expired')}</p>
  }
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <p className="mb-4 text-center text-xs text-white/60" aria-live="off">
      {t('checkout.seats_held_for', { time })}
    </p>
  )
}

/**
 * The breakdown the SERVER computed for this PaymentIntent.
 *
 * Preferred over anything this component could work out: it is the same object the
 * charge amount was built from, so the "Pay X" button cannot drift from what the
 * card is actually charged — including buyer-pays markets, where the fee is added
 * on top of the face value.
 */
interface ServerPricing {
  currency: string
  incidence: 'organizer' | 'buyer'
  faceValue: number
  buyerFee: number
  total: number
}

interface CheckoutFormProps {
  eventId: string
  eventTitle: string
  quantity: number
  /** Face-value total, used only until the server's breakdown arrives. */
  totalAmount: number
  currency: string
  country?: string
  /** The organizer's absorb/pass-on choice for this event, when they made one. */
  feeIncidence?: string | null
  /** PAID tickets in the order (the market's fixed fee is per paid ticket). */
  paidQuantity: number
  pricing: ServerPricing | null
  onClose: () => void
  clientSecret: string
  /**
   * Where a GUEST goes once the card clears — their own signed ticket page. Account
   * holders have /tickets and this stays null for them.
   */
  guestTicketUrl: string | null
  t: any
}

function CheckoutForm({ eventId, eventTitle, quantity, totalAmount, currency, country, feeIncidence, paidQuantity, pricing, onClose, clientSecret, guestTicketUrl, t }: CheckoutFormProps) {
  // Server breakdown when we have it; the same shared calculation as a fallback so a
  // buyer-pays market never renders a bare face value as the total. Priced against
  // the EVENT, so an organizer who absorbs the fee is not shown one.
  const local = priceOrder(
    totalAmount,
    { country, currency, fee_incidence: feeIncidence },
    { quantity: paidQuantity, currency }
  )
  const faceValue = pricing ? pricing.faceValue : local.faceValue
  const buyerFee = pricing ? pricing.buyerFee : local.buyerFee
  const chargeTotal = pricing ? pricing.total : local.total
  const chargeCurrency = pricing?.currency || currency
  const showFeeLine = buyerFee > 0
  const formatAmount = (amount: number) => `${amount.toLocaleString()} ${chargeCurrency}`

  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const { showToast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const { error: submitError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/purchase/success`,
        },
        redirect: 'if_required',
      })

      if (submitError) {
        setError(
          submitError.message || t('checkout.payment_failed', { defaultValue: 'Payment failed' })
        )
        setProcessing(false)
      } else {
        // Payment succeeded - create tickets immediately
        try {
          // Get the payment intent ID from the elements
          const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret)
          
          if (paymentIntent) {
            // Call our API to create tickets
            const response = await fetch('/api/tickets/create-from-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // The client secret proves this browser paid; a guest has no session.
              body: JSON.stringify({ paymentIntentId: paymentIntent.id, clientSecret }),
            })

            if (!response.ok) {
              console.error('Failed to create tickets immediately, webhook will handle it')
            }
          }
        } catch (err) {
          console.error('Error creating tickets:', err)
          // Don't fail the whole flow - webhook will handle it
        }

        // Show success message
        showToast({
          type: 'success',
          title: t('checkout.payment_successful_title', { defaultValue: 'Payment successful!' }),
          message:
            quantity > 1
              ? t('checkout.payment_successful_message_plural', {
                  defaultValue: 'Your tickets have been confirmed',
                })
              : t('checkout.payment_successful_message', {
                  defaultValue: 'Your ticket has been confirmed',
                }),
          duration: 5000
        })

        // Where to land. A guest has no /tickets page — send them to their signed
        // ticket link, which is also where the account is offered.
        if (guestTicketUrl) {
          window.location.href = `${guestTicketUrl}?purchased=1`
          return
        }

        router.push(`/tickets?payment_success=true`)
        router.refresh()
      }
    } catch (err: any) {
      setError(
        err.message || t('checkout.unexpected_error', { defaultValue: 'An unexpected error occurred' })
      )
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Order Summary */}
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">{t('events.order_summary')}</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-white/65">{eventTitle}</span>
            <span className="font-medium text-white">x{quantity}</span>
          </div>
          {showFeeLine && (
            <>
              <div className="flex justify-between">
                <span className="text-white/65">{t('events.subtotal', { defaultValue: 'Subtotal' })}</span>
                <span className="font-medium text-white">{formatAmount(faceValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/65">
                  {t('checkout.service_fee', { defaultValue: 'Service fee' })}
                </span>
                <span className="font-medium text-white">{formatAmount(buyerFee)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-white/10">
            <span className="font-semibold text-white">{t('events.total')}</span>
            <span className="text-lg font-bold text-brand-300">{formatAmount(chargeTotal)}</span>
          </div>
          {showFeeLine && (
            <p className="text-xs text-white/45">
              {t('checkout.service_fee_nonrefundable', {
                defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
              })}
            </p>
          )}
        </div>
      </div>

      {/* Payment Element */}
      <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-white/65" />
          <h3 className="text-sm font-semibold text-white">{t('events.payment_details')}</h3>
        </div>
        <PaymentElement />
      </div>

      {error && (
        <div className="rounded-lg bg-error-500/10 p-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Security Badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-white/70">
        <Lock className="w-3 h-3" />
        <span>{t('events.secure_payment_stripe')}</span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={processing}
          className="flex-1 px-4 py-3 border border-white/10 rounded-lg font-medium text-white/70 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="flex-1 px-4 py-3 bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
        >
          {processing ? t('events.processing') : `${t('events.pay')} ${formatAmount(chargeTotal)}`}
        </button>
      </div>
    </form>
  )
}

interface EmbeddedStripePaymentProps {
  eventId: string
  eventTitle: string
  userId: string | null
  quantity: number
  /**
   * PAID tickets in the order, for the pre-server fallback total. Defaults to
   * `quantity`; a mixed cart's free tickets must not be counted.
   */
  paidQuantity?: number
  /** FACE total, after any promo. The fee (buyer-pays) is added on top by the server. */
  totalAmount: number
  currency: string
  /** Event country — the default for who pays the fee. */
  country?: string
  /** The organizer's own absorb/pass-on choice, which outranks the country default. */
  feeIncidence?: string | null
  tierId?: string
  /**
   * The whole cart, one entry per tier. Sent as `tiers` so a mixed cart (VIP ×1 +
   * GA ×2) is priced and issued per tier; `tierId` + `quantity` remain for a
   * single-tier purchase.
   */
  tiers?: { tierId: string; quantity: number }[]
  promoCodeId?: string
  /** Promoter ref code captured from `?ref=` — resolved and attributed server-side. */
  refCode?: string
  /** Tracking-link / utm attribution captured on the event page. */
  attribution?: Attribution | null
  /**
   * A GUEST's access code for a password-protected event. There is no uid to hold a
   * grant before the order exists, so the code is presented with the PaymentIntent
   * request and re-verified server-side. Null for account holders, who are admitted
   * by their stored grant.
   */
  accessCode?: string | null
  /**
   * Present when the buyer has no account: the contact details they gave at checkout.
   * Forwarded to create-payment-intent, which validates them and mints the guest order
   * BEFORE the card is charged, so the confirmation recipient is fixed by then.
   */
  guest?: { name: string; email: string; phone: string } | null
  onClose: () => void
}

export default function EmbeddedStripePayment({
  eventId,
  eventTitle,
  userId,
  quantity,
  paidQuantity,
  totalAmount,
  currency,
  country,
  feeIncidence,
  tierId,
  tiers,
  promoCodeId,
  refCode,
  attribution,
  accessCode,
  guest,
  onClose
}: EmbeddedStripePaymentProps) {
  // Stable dependency for the PaymentIntent effect (an object would re-fire it).
  const attributionKey = attribution ? JSON.stringify(attribution) : ''
  const tiersKey = tiers && tiers.length > 0 ? JSON.stringify(tiers.map((l) => ({ tierId: l.tierId, quantity: l.quantity }))) : ''
  const { t, i18n } = useTranslation('common')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [pricing, setPricing] = useState<ServerPricing | null>(null)
  const [guestTicketUrl, setGuestTicketUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seatHold, setSeatHold] = useState<SeatHold | null>(null)
  const seatHoldRef = useRef<SeatHold | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Closing the sheet without paying gives the held seats back now instead of at
  // expiry. Best-effort; a seat already paid for is never released by the server.
  const closeSheet = useCallback(() => {
    const hold = seatHoldRef.current
    seatHoldRef.current = null
    if (hold) {
      fetch('/api/checkout/release-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: hold.id, releaseToken: hold.releaseToken }),
        keepalive: true,
      }).catch(() => undefined)
    }
    onClose()
  }, [onClose])

  // Modal a11y: close on Escape, focus the first control on mount.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKeyDown)
    closeButtonRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSheet])

  // Map i18next language codes to Stripe locale codes
  const getStripeLocale = () => {
    const lang = i18n.language
    if (lang === 'fr') return 'fr'
    if (lang === 'ht') return 'fr' // Stripe doesn't support Haitian Creole, use French as fallback
    return 'en' // Default to English
  }

  useEffect(() => {
    // Create PaymentIntent on component mount
    const createPaymentIntent = async () => {
      try {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId,
            quantity,
            // The cart, per tier, when there is one; the server prices every line.
            ...(tiersKey ? { tiers: JSON.parse(tiersKey) } : { tierId }),
            promoCodeId,
            ...(refCode ? { refCode } : {}),
            ...(attributionKey ? { attribution: JSON.parse(attributionKey) } : {}),
            ...(guest ? { guest } : {}),
            ...(accessCode ? { accessCode } : {}),
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          if (data?.code === 'organizer_payments_unavailable') {
            throw new Error(
              t('checkout.organizer_payments_unavailable', { defaultValue: data.error })
            )
          }
          throw new Error(
            data.error || t('checkout.initialize_payment_failed', { defaultValue: 'Failed to initialize payment' })
          )
        }

        setClientSecret(data.clientSecret)
        setPricing(data.pricing || null)
        setGuestTicketUrl(data.guestTicketUrl || null)
        if (data.seatHold?.id) {
          seatHoldRef.current = data.seatHold
          setSeatHold(data.seatHold)
        }
      } catch (err: any) {
        setError(
          err.message ||
            t('checkout.initialize_payment_failed', { defaultValue: 'Failed to initialize payment' })
        )
      } finally {
        setLoading(false)
      }
    }

    createPaymentIntent()
    // `guest` is a fresh object each render; key the effect on its VALUES so a guest
    // checkout doesn't re-mint a PaymentIntent (and a second guest order) on every
    // parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, quantity, tierId, tiersKey, promoCodeId, refCode, attributionKey, accessCode, guest?.name, guest?.email, guest?.phone])

  const appearance = {
    theme: 'night' as const,
    variables: {
      colorPrimary: '#14B8A6',
      colorBackground: '#0a0a0a',
      colorText: '#ffffff',
      colorDanger: '#ef4444',
      fontFamily: 'system-ui, sans-serif',
      spacingUnit: '4px',
      borderRadius: '8px',
    },
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('events.complete_payment')}
        className="bg-[#111] w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0a0a0a] border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{t('events.complete_payment')}</h2>
          <button
            ref={closeButtonRef}
            onClick={closeSheet}
            className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5 text-white/50" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500"></div>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-error-500/10 p-6 text-center">
              <p className="text-red-300 mb-4">{error}</p>
              <button
                onClick={closeSheet}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                {t('common.close')}
              </button>
            </div>
          ) : clientSecret ? (
            <>
              {seatHold && <SeatHoldCountdown expiresAt={seatHold.expiresAt} t={t} />}
              <Elements stripe={stripePromise} options={{ clientSecret, appearance, locale: getStripeLocale() as any }}>
                <CheckoutForm
                  eventId={eventId}
                  eventTitle={eventTitle}
                  quantity={quantity}
                  totalAmount={totalAmount}
                  currency={currency}
                  country={country}
                  feeIncidence={feeIncidence}
                  paidQuantity={paidQuantity ?? quantity}
                  pricing={pricing}
                  onClose={closeSheet}
                  clientSecret={clientSecret}
                  guestTicketUrl={guestTicketUrl}
                  t={t}
                />
              </Elements>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
