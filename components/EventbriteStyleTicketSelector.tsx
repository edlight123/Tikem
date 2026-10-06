'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { allSelectionsFree, computeSelectionTotal, isFreeTier } from '@/lib/ticketPricing'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import { ticketScarcity, scarcityCopy, isUrgent } from '@/lib/ticketScarcity'

interface TicketTier {
  id: string
  name: string
  description: string | null
  price: number
  total_quantity: number
  sold_quantity: number
  sales_start: string | null
  sales_end: string | null
  is_active?: boolean
}

interface TierQuantity {
  [tierId: string]: number
}

interface PromoCodeValidation {
  valid: boolean
  promoCode?: {
    id: string
    code: string
    description: string
    discountType: 'percentage' | 'fixed'
    discountValue: number
  }
}

interface EventbriteStyleTicketSelectorProps {
  eventId: string
  userId: string | null
  currency?: string
  /**
   * The event's country. Decides WHO PAYS THE FEE: in a buyer-pays market
   * (US/CA/FR) the fee is added on top, so the total shown here — and on the
   * checkout button — is the face value plus that fee, with the fee itemized.
   * Haiti is organizer-pays, where the fee is 0 and every number below is the
   * face value, exactly as before.
   */
  country?: string
  /** Event start, for the "selling fast" pace rule. Omit and it never fires. */
  eventStartsAt?: string | null
  /**
   * Let a logged-OUT visitor select and check out as a guest. The contact details
   * (name / email / phone) are collected by the parent right after this, so the
   * selector only needs to stop treating "no session" as "no sale".
   *
   * Promo codes work for guests too: /api/promo-codes/validate no longer requires a
   * session (the code an organizer printed on a flyer was unusable for exactly the
   * buyers who can't sign in), so the box below follows `canPurchase`.
   */
  allowGuest?: boolean
  /**
   * `discountedTotal` is what THIS component computed after applying the promo —
   * a routing hint only (it decides whether to try the free-claim endpoint). The
   * server re-prices the order from Firestore and has the final say.
   */
  onPurchase: (
    selections: { tierId: string; quantity: number; price: number; tierName?: string }[],
    promoCodeId?: string,
    discountedTotal?: number
  ) => void
}

export default function EventbriteStyleTicketSelector({
  eventId,
  userId,
  currency = 'HTG',
  country,
  eventStartsAt,
  allowGuest = false,
  onPurchase
}: EventbriteStyleTicketSelectorProps) {
  /** Who may press "checkout": a signed-in user, or a guest when guests are allowed. */
  const canPurchase = Boolean(userId) || allowGuest
  const { t } = useTranslation('common')
  const [tiers, setTiers] = useState<TicketTier[]>([])
  const [quantities, setQuantities] = useState<TierQuantity>({})
  const [loading, setLoading] = useState(true)
  const [promoCode, setPromoCode] = useState('')
  const [promoValidation, setPromoValidation] = useState<PromoCodeValidation | null>(null)
  const [validatingPromo, setValidatingPromo] = useState(false)
  const [promoError, setPromoError] = useState<string | null>(null)
  /** Whether the promo input is revealed. Collapsed by default — see below. */
  const [promoOpen, setPromoOpen] = useState(false)

  const fetchTiers = useCallback(async () => {
    try {
      const response = await fetch(`/api/ticket-tiers?eventId=${eventId}`)
      if (!response.ok) throw new Error('Failed to fetch tiers')
      const data = await response.json()
      setTiers(data.tiers || [])
      
      // Initialize quantities to 0
      const initialQuantities: TierQuantity = {}
      data.tiers?.forEach((tier: TicketTier) => {
        initialQuantities[tier.id] = 0
      })
      setQuantities(initialQuantities)
    } catch (error) {
      console.error('Error fetching tiers:', error)
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    fetchTiers()
  }, [fetchTiers])

  const isTierAvailable = (tier: TicketTier): boolean => {
    const now = new Date()

    if (tier.is_active === false) {
      return false
    }
    
    if (tier.sales_start && new Date(tier.sales_start) > now) {
      return false
    }
    
    if (tier.sales_end && new Date(tier.sales_end) < now) {
      return false
    }
    
    return (tier.total_quantity - (tier.sold_quantity || 0)) > 0
  }

  const getAvailableQuantity = (tier: TicketTier): number => {
    return tier.total_quantity - (tier.sold_quantity || 0)
  }

  /** This tier's scarcity, from the shared ladder. */
  const scarcityFor = (tier: TicketTier) =>
    ticketScarcity({
      total: tier.total_quantity,
      sold: tier.sold_quantity,
      // Pace needs the horizon. Absent (the caller did not pass it), the
      // "selling fast" rung simply never fires — which is correct: we would
      // have no evidence for the claim.
      startsAt: eventStartsAt,
    })

  const updateQuantity = (tierId: string, delta: number) => {
    const tier = tiers.find(t => t.id === tierId)
    if (!tier) return

    const maxAvailable = getAvailableQuantity(tier)
    const newQuantity = Math.max(0, Math.min(maxAvailable, (quantities[tierId] || 0) + delta))
    
    setQuantities(prev => ({
      ...prev,
      [tierId]: newQuantity
    }))
  }

  const getTotalTickets = (): number => {
    return Object.values(quantities).reduce((sum, qty) => sum + qty, 0)
  }

  /** The tiers the buyer has actually put in the cart, with unit price and quantity. */
  const getSelections = () =>
    tiers
      .filter((tier) => (quantities[tier.id] || 0) > 0)
      .map((tier) => ({
        tierId: tier.id,
        quantity: quantities[tier.id],
        price: tier.price,
        tierName: tier.name,
      }))

  // Money math runs on integer cents inside computeSelectionTotal, so 3 × 10.10 is
  // exactly 30.30 and a percentage promo can't leave binary-float dust behind.
  const getTotalPrice = (): number => {
    const discount = promoValidation?.valid && promoValidation.promoCode
      ? promoValidation.promoCode.discountType === 'percentage'
        ? { percentage: promoValidation.promoCode.discountValue }
        : { amount: promoValidation.promoCode.discountValue }
      : null

    return computeSelectionTotal(getSelections(), discount)
  }

  /** Format a unit/line amount, showing a genuine zero as "Free" rather than "0.00 HTG". */
  const formatMoney = (amount: number): string =>
    amount === 0 ? t('common.free') : `${amount.toFixed(2)} ${currency}`

  const validatePromoCode = async () => {
    if (!promoCode.trim() || !canPurchase) return

    setValidatingPromo(true)
    setPromoError(null)
    try {
      const response = await fetch('/api/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode, eventId }),
      })

      const data = await response.json()

      if (response.ok && data.valid) {
        setPromoValidation(data)
        setPromoError(null)
      } else {
        setPromoError(data.error || t('checkout.promo_invalid', { defaultValue: 'Invalid promo code' }))
        setPromoValidation(null)
      }
    } catch (error) {
      console.error('Error validating promo:', error)
      setPromoError(t('checkout.promo_validate_failed', { defaultValue: 'Failed to validate promo code' }))
    } finally {
      setValidatingPromo(false)
    }
  }

  const handlePurchase = () => {
    if (!canPurchase) return

    const selections = getSelections()

    if (selections.length === 0) return

    onPurchase(selections, promoValidation?.promoCode?.id, getTotalPrice())
  }

  if (loading) {
    return <p className="text-white/65">{t('events.loading_ticket_options')}</p>
  }

  if (tiers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-white/65 mb-4">{t('events.no_ticket_tiers')}</p>
        <p className="text-sm text-white/70">{t('events.no_ticket_tiers_desc')}</p>
      </div>
    )
  }

  const totalTickets = getTotalTickets()
  /** Face total: what the organizer priced, after any promo. */
  const totalPrice = getTotalPrice()
  // ALL-IN TOTAL, computed once for the whole order (the fee's fixed component is
  // per transaction, so it must not be grossed up per ticket). In Haiti this is the
  // face total and `buyerFee` is 0, so the rows below collapse to what they always
  // showed. In a buyer-pays market the buyer sees the number their card will be
  // charged here, before they reach any payment screen.
  // The fee is a flat rate of the order total (no per-ticket cap), so quantity
  // does not change it; it is passed for the pricing seam's order context.
  const orderQuantity = getSelections().reduce((sum, s) => sum + s.quantity, 0)
  const orderPricing = priceOrder(totalPrice, country, {
    quantity: orderQuantity,
    currency,
  })
  const showFeeLine = orderPricing.feeOnTop && orderPricing.buyerFee > 0
  // Free ISSUANCE is decided by each selected tier's OWN price, not by the total.
  // A cart zeroed by a 100%-off promo still has to go through checkout — the
  // free-claim endpoint requires the tier itself to cost 0 and would refuse it.
  const isFreeOrder = allSelectionsFree(getSelections())

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">{t('events.select_tickets')}</h3>

      {/* Tier List with Quantity Selectors */}
      <div className="space-y-3">
        {tiers.map((tier) => {
          const available = getAvailableQuantity(tier)
          const isAvailable = isTierAvailable(tier)
          const quantity = quantities[tier.id] || 0

          return (
            <div
              key={tier.id}
              /* A FILL, not a hairline around an empty box — the house rule
                 ("not everything needs to be a border w no fill"). The
                 selected state used to be `border-brand-500` with no
                 background at all, so a chosen tier and an unchosen one
                 differed by one pixel of teal. */
              className={`rounded-xl p-4 transition-colors ${
                quantity > 0
                  ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50'
                  : isAvailable
                  ? 'bg-white/[0.03] hover:bg-white/[0.06]'
                  : 'bg-white/[0.03] opacity-50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Tier Info */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-white">{tier.name}</h4>
                  {tier.description && (
                    <p className="text-sm text-white/65 mt-1">{tier.description}</p>
                  )}
                  {/* Two lines on purpose. These shared one `flex gap-3` row,
                      and once the stepper has taken its ~140px the tier column
                      is about 200px wide on a phone — so "10.00 HTG + fees"
                      and "100 available" wrapped INSIDE their spans and the
                      price broke across two lines. Price leads on its own
                      line; availability is a quiet second. */}
                  <p className="mt-2 text-sm font-medium text-brand-400">
                    {isFreeTier(tier) ? t('common.free') : `${tier.price.toFixed(2)} ${currency}`}
                    {/* Never let a bare face value read as the total. The all-in
                        number is itemized in the summary below, where the fee can be
                        stated for the order as a whole. */}
                    {!isFreeTier(tier) && orderPricing.feeOnTop && (
                      <span className="ml-1 font-normal text-white/50">
                        {t('checkout.plus_fees', { defaultValue: '+ fees' })}
                      </span>
                    )}
                  </p>
                  {/* Scarcity, not inventory. This printed the raw count on
                      every tier — "100 available" — which tells a buyer to come
                      back later. The exact number now appears only when it is
                      genuinely small; see lib/ticketScarcity for why each rung
                      has to be true. Nothing is rendered when there is plenty,
                      so the line's presence is itself the signal. */}
                  {(() => {
                    const copy = scarcityCopy(scarcityFor(tier))
                    if (!copy) return null
                    const urgent = isUrgent(scarcityFor(tier))
                    return (
                      <p
                        className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium ${
                          urgent ? 'text-amber-300' : 'text-red-400'
                        }`}
                      >
                        {urgent && (
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                        )}
                        {t(copy.key, { defaultValue: copy.defaultValue, count: copy.count })}
                      </p>
                    )
                  })()}
                  {!isAvailable && available > 0 && (
                    <p className="text-xs text-amber-400 mt-1">
                      {tier.sales_start && new Date(tier.sales_start) > new Date()
                        ? `${t('events.sales_start')} ${new Date(tier.sales_start).toLocaleDateString()}`
                        : `${t('events.sales_ended')} ${new Date(tier.sales_end!).toLocaleDateString()}`}
                    </p>
                  )}
                </div>

                {/* Quantity Selector */}
                {isAvailable && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(tier.id, -1)}
                      disabled={quantity === 0}
                      aria-label={`${t('events.decrease_quantity', { defaultValue: 'Decrease quantity' })}, ${tier.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.07] transition-colors hover:bg-white/[0.14] disabled:opacity-30 disabled:cursor-not-allowed sm:h-9 sm:w-9"
                    >
                      <Minus className="w-4 h-4 text-white/80" />
                    </button>
                    <span className="w-12 text-center font-semibold text-white text-lg">
                      {quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(tier.id, 1)}
                      disabled={quantity >= available}
                      aria-label={`${t('events.increase_quantity', { defaultValue: 'Increase quantity' })}, ${tier.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.07] transition-colors hover:bg-white/[0.14] disabled:opacity-30 disabled:cursor-not-allowed sm:h-9 sm:w-9"
                    >
                      <Plus className="w-4 h-4 text-white/80" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Promo code — one line until somebody wants it.
          It was a bordered card with its own heading and 16px of padding above
          an input row: roughly 110px of a phone sheet spent on a field most
          buyers never touch, pushing the total and the checkout button below
          the fold. Now it is a text link that expands in place, and it stays
          expanded once a code is applied so the discount is never hidden. */}
      {!promoOpen && !promoValidation?.valid ? (
        <button
          type="button"
          onClick={() => setPromoOpen(true)}
          disabled={!canPurchase}
          className="min-h-11 text-left text-sm font-medium text-brand-400 transition-colors hover:text-brand-300 disabled:opacity-40"
        >
          {/* An invitation, not a field label: "Promo Code (optional)" is what
              the heading above an input says, and reads oddly as a link. */}
          {t('events.promo_code_prompt', { defaultValue: 'Have a promo code?' })}
        </button>
      ) : (
        <div>
          <label htmlFor="promo-code" className="mb-1.5 block text-xs uppercase tracking-wider text-white/50">
            {t('events.promo_code_optional')}
          </label>
          <div className="flex gap-2">
            <input
              id="promo-code"
              type="text"
              autoFocus={promoOpen && !promoValidation?.valid}
              value={promoCode}
              onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoError(null) }}
              placeholder={t('events.enter_code')}
              disabled={!canPurchase || validatingPromo}
              /* Filled, and 16px so iOS does not zoom the sheet on focus. */
              className="min-w-0 flex-1 rounded-lg bg-white/[0.055] px-3 py-2.5 text-[16px] uppercase text-white placeholder:text-white/35 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-brand-400/50 disabled:opacity-50"
            />
            <button
              onClick={validatePromoCode}
              disabled={!canPurchase || !promoCode.trim() || validatingPromo}
              className="min-h-11 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed"
            >
              {validatingPromo ? '…' : t('events.apply')}
            </button>
          </div>
          {promoError && (
            <div className="mt-2 text-sm text-red-300" role="alert">
              {promoError}
            </div>
          )}
          {promoValidation?.valid && (
            <div className="mt-2 flex items-center gap-1 text-sm text-green-400">
              <span aria-hidden>✓</span>
              <span>{promoValidation.promoCode?.description || t('events.promo_code_applied')}</span>
            </div>
          )}
        </div>
      )}

      {/* Total Summary */}
      {totalTickets > 0 && (
        <div className="rounded-xl bg-white/[0.03] p-4">
          <div className="space-y-2">
            {tiers
              .filter(tier => quantities[tier.id] > 0)
              .map(tier => (
                <div key={tier.id} className="flex justify-between text-sm">
                  <span className="text-white/65">
                    {quantities[tier.id]}× {tier.name}
                  </span>
                  <span className="text-white">
                    {formatMoney(
                      computeSelectionTotal([{ price: tier.price, quantity: quantities[tier.id] }])
                    )}
                  </span>
                </div>
              ))}
            {promoValidation?.valid && promoValidation.promoCode && (
              <div className="flex justify-between text-sm text-green-400">
                <span>
                  {t('events.promo_discount')} ({promoValidation.promoCode.code})
                </span>
                <span>
                  -{promoValidation.promoCode.discountType === 'percentage' 
                    ? `${promoValidation.promoCode.discountValue}%` 
                    : `${promoValidation.promoCode.discountValue.toFixed(2)} ${currency}`}
                </span>
              </div>
            )}
            {showFeeLine && (
              <div className="flex justify-between text-sm text-white/65">
                <span>{t('checkout.service_fee', { defaultValue: 'Service fee' })}</span>
                <span className="text-white">{formatMoney(orderPricing.buyerFee)}</span>
              </div>
            )}
            <div className="border-t border-white/10 pt-2 flex justify-between font-semibold text-lg">
              <span>{t('events.total')} ({totalTickets} {t('ticket.ticket')}{totalTickets !== 1 ? 's' : ''})</span>
              <span className="text-brand-400">{formatMoney(orderPricing.total)}</span>
            </div>
            {showFeeLine && (
              <p className="text-xs text-white/45">
                {t('checkout.total_includes_fees', {
                  defaultValue: 'Total includes all fees. This is what you pay.',
                })}{' '}
                {t('checkout.service_fee_nonrefundable', {
                  defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={!canPurchase || totalTickets === 0}
        className="min-h-11 w-full rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed"
      >
        {!canPurchase
          ? t('events.sign_in_to_purchase')
          : totalTickets === 0
          ? t('events.select_tickets')
          : isFreeOrder
          ? totalTickets === 1
            ? t('events.get_free_ticket', { defaultValue: 'Get free ticket' })
            : t('events.get_free_tickets', { defaultValue: 'Get free tickets' })
          : `${t('events.checkout')} - ${formatMoney(orderPricing.total)}`
        }
      </button>
    </div>
  )
}
