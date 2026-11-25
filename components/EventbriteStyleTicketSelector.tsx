'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { allSelectionsFree, isFreeTier, MAX_FREE_TICKETS_PER_PERSON, tierMaxPerOrder } from '@/lib/ticketPricing'
import { priceCart } from '@/lib/checkout/buyer-pricing'
import { formatMoney } from '@/lib/money'
import { MAX_DOOR_TICKETS_PER_PERSON, doorMoney, doorPriceLabel, doorPriceOf, isDoorTier } from '@/lib/tickets/pay-at-door'
import { ticketScarcity, scarcityCopy, isUrgent } from '@/lib/ticketScarcity'
import QtyStepper from '@/components/QtyStepper'
import AddOnsPicker, { selectedAddOnsFrom, type SelectedAddOn } from '@/components/AddOnsPicker'
import { addOnAvailability, eventAddOns } from '@/lib/addons/addOns'

interface TicketTier {
  id: string
  name: string
  description: string | null
  price: number
  /** Pay at the door: owed on arrival (price is then 0). */
  door_price?: number | null
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
  /**
   * The organizer's own absorb/pass-on choice for this event. Outranks the
   * country default: a US organizer who absorbs the fee shows face value only.
   */
  feeIncidence?: string | null
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
   * The buyer already holds this event's free claim (one per event). Free tiers
   * stay listed but closed, with the reason; paid tiers sell as usual.
   */
  freeClaimHeld?: boolean
  /** Free tickets one person may claim here: 2, or the family size (lib/events/family). */
  freeCap?: number
  /**
   * `discountedTotal` is what THIS component computed after applying the promo —
   * a routing hint only (it decides whether to try the free-claim endpoint). The
   * server re-prices the order from Firestore and has the final say. `promo` is
   * the applied code's terms, so the checkout summary can show the same discount.
   */
  /** The event's add-ons (events.add_ons) and their sold rollup, offered after the tiers. */
  addOns?: unknown
  addOnsSold?: Record<string, unknown> | null
  onPurchase: (
    selections: { tierId: string; quantity: number; price: number; tierName?: string }[],
    promoCodeId?: string,
    discountedTotal?: number,
    promo?: { discount_type: string; discount_value: number },
    addOns?: SelectedAddOn[]
  ) => void
}

export default function EventbriteStyleTicketSelector({
  eventId,
  userId,
  currency = 'HTG',
  country,
  feeIncidence,
  eventStartsAt,
  allowGuest = false,
  freeClaimHeld = false,
  freeCap = MAX_FREE_TICKETS_PER_PERSON,
  addOns: rawAddOns,
  addOnsSold = null,
  onPurchase
}: EventbriteStyleTicketSelectorProps) {
  const addOnList = eventAddOns({ add_ons: rawAddOns })
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({})
  /** Who may press "checkout": a signed-in user, or a guest when guests are allowed. */
  const canPurchase = Boolean(userId) || allowGuest
  const { t, i18n } = useTranslation('common')
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

    // Free tickets are capped per person across every free tier together;
    // pay-at-the-door spots have their own, larger cap (families).
    const door = isDoorTier(tier)
    const sameKind = (t: TicketTier) => (door ? isDoorTier(t) : isFreeTier(t) && !isDoorTier(t))
    const kindCap = door ? MAX_DOOR_TICKETS_PER_PERSON : freeCap
    const otherSameKind = door || isFreeTier(tier)
      ? tiers.reduce((sum, t) => (t.id !== tierId && sameKind(t) ? sum + (quantities[t.id] || 0) : sum), 0)
      : 0
    const stockOrFreeCap = door || isFreeTier(tier)
      ? Math.min(getAvailableQuantity(tier), Math.max(0, kindCap - otherSameKind))
      : getAvailableQuantity(tier)
    // The organizer's per-order limit on this tier, when set.
    const maxAvailable = Math.min(stockOrFreeCap, tierMaxPerOrder(tier as any) ?? Infinity)
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

  /**
   * The applied promo in the shape the payment routes apply it: per TICKET
   * (calculateDiscount), so a fixed-amount code comes off every ticket and the
   * total here is the total the server charges. It used to come off the order
   * once, which under-quoted the discount on any multi-ticket cart.
   */
  const appliedPromo =
    promoValidation?.valid && promoValidation.promoCode
      ? {
          discount_type: promoValidation.promoCode.discountType,
          discount_value: Number(promoValidation.promoCode.discountValue) || 0,
        }
      : null

  // The whole cart, priced once: promo per ticket, then the fee on the post-promo
  // face total, honouring the organizer's absorb/pass-on choice for this event.
  // Add-ons (no promo) join the face total, so the one fee covers the full
  // subtotal. Not offered with pay-at-the-door spots (never a card order).
  const doorSelected = tiers.some((tier) => isDoorTier(tier) && (quantities[tier.id] || 0) > 0)
  const getSelectedAddOns = (): SelectedAddOn[] =>
    doorSelected
      ? []
      : selectedAddOnsFrom(
          // Only add-ons the CURRENT tiers allow (a tier removed after picking drops its add-ons).
          addOnList.filter(
            (a) => addOnAvailability(a, { cartTierIds: getSelections().map((s) => s.tierId), soldMap: addOnsSold }) === 'available'
          ),
          addOnQty
        )
  const getCartPricing = () =>
    priceCart(getSelections(), { country, currency, fee_incidence: feeIncidence }, {
      promo: appliedPromo,
      currency,
      addOns: getSelectedAddOns().map((a) => ({ unitPrice: a.unitPrice, quantity: a.quantity })),
    })

  /** Post-promo face total. */
  const getTotalPrice = (): number => getCartPricing().faceValue


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

    onPurchase(selections, promoValidation?.promoCode?.id, getTotalPrice(), appliedPromo || undefined, getSelectedAddOns())
  }

  if (loading) {
    return <div className="text-fg-muted">{t('events.loading_ticket_options')}</div>
  }

  if (tiers.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-fg-muted mb-4">{t('events.no_ticket_tiers')}</div>
        <div className="text-sm text-fg-muted">{t('events.no_ticket_tiers_desc')}</div>
      </div>
    )
  }

  const totalTickets = getTotalTickets()
  // ALL-IN TOTAL, computed once for the whole order. Under organizer incidence
  // (Haiti's default, or any organizer who absorbs) this is the face total and
  // `buyerFee` is 0, so the rows below collapse to the face value. When the fee
  // is passed on, the buyer sees the number their card will be charged here,
  // before they reach any payment screen. The market's fixed fee (US/CA/FR) is
  // counted per PAID ticket only — priceCart leaves free lines out.
  const orderPricing = getCartPricing()
  const showFeeLine = orderPricing.feeOnTop && orderPricing.buyerFee > 0
  // Free ISSUANCE is decided by each selected tier's OWN price, not by the total.
  // A cart zeroed by a 100%-off promo still has to go through checkout — the
  // free-claim endpoint requires the tier itself to cost 0 and would refuse it.
  const chosenAddOns = getSelectedAddOns()
  const isFreeOrder = allSelectionsFree(getSelections()) && chosenAddOns.length === 0
  /** Pay at the door: what the chosen spots will cost on arrival (nothing online). */
  const doorDue = tiers.reduce((sum, tier) => sum + doorPriceOf(tier) * (quantities[tier.id] || 0), 0)

  const addOnCount = chosenAddOns.reduce((sum, a) => sum + a.quantity, 0)
  const te = (key: string, opts?: Record<string, unknown>) => t(key, { ns: 'events', ...(opts || {}) })

  return (
    <div className="space-y-5">
      <h3 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('events.select_tickets')}</h3>

      {/* Tickets: plain rows on the canvas split by a thin divider, the way the
          app's selector reads (no boxed cards, no teal ring). Name left, price
          right in white, one muted detail line, the 40px stepper. */}
      <section aria-labelledby="choose-tickets-label">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <div id="choose-tickets-label" className="text-caption font-bold uppercase tracking-[0.07em] text-fg-muted">
            {te('addOns.buyer.chooseTickets', { defaultValue: 'Choose tickets' })}
          </div>
        </div>
        <ul>
          {tiers.map((tier, index) => {
            const available = getAvailableQuantity(tier)
            // A held free claim closes every free tier; the route would refuse it.
            const freeClaimClosed = freeClaimHeld && isFreeTier(tier) && !isDoorTier(tier)
            const isAvailable = isTierAvailable(tier) && !freeClaimClosed
            const quantity = quantities[tier.id] || 0
            const priceText = isDoorTier(tier)
              ? doorPriceLabel(doorPriceOf(tier), currency, i18n.language)
              : isFreeTier(tier)
                ? t('common.free')
                : formatMoney(tier.price, currency)
            // One muted line: scarcity / claim state / sale window, then the description.
            const detail: Array<{ text: string; tone: 'muted' | 'warn' | 'danger' | 'ok'; dot?: boolean }> = []
            if (freeClaimClosed) {
              detail.push({ text: t('events.free_tier_already_claimed', { defaultValue: 'You already have your free ticket' }), tone: 'ok', dot: true })
            } else if (!isAvailable && available > 0) {
              detail.push({
                text:
                  tier.sales_start && new Date(tier.sales_start) > new Date()
                    ? `${t('events.sales_start')} ${new Date(tier.sales_start).toLocaleDateString()}`
                    : `${t('events.sales_ended')} ${new Date(tier.sales_end!).toLocaleDateString()}`,
                tone: 'warn',
              })
            } else {
              const copy = scarcityCopy(scarcityFor(tier))
              if (copy) {
                detail.push({
                  text: t(copy.key, { defaultValue: copy.defaultValue, count: copy.count }),
                  tone: isUrgent(scarcityFor(tier)) ? 'warn' : 'danger',
                  dot: isUrgent(scarcityFor(tier)),
                })
              }
            }
            if (!isFreeTier(tier) && orderPricing.feeOnTop) {
              detail.push({ text: t('checkout.plus_fees', { defaultValue: '+ fees' }), tone: 'muted' })
            }
            if (tier.description) detail.push({ text: tier.description, tone: 'muted' })
            return (
              <li
                key={tier.id}
                className={`flex items-center gap-3 py-2.5 ${index < tiers.length - 1 ? 'border-b border-line' : ''} ${
                  isAvailable ? '' : 'opacity-70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">{tier.name}</span>
                    <span className="shrink-0 text-body font-bold tabular-nums text-fg">{priceText}</span>
                  </div>
                  {detail.length > 0 && (
                    <div className="mt-0.5 truncate text-eyebrow text-fg-muted">
                      {detail.map((d, i) => (
                        <span key={i}>
                          {i > 0 ? ' · ' : ''}
                          <span
                            className={
                              d.tone === 'warn'
                                ? 'text-warning-soft'
                                : d.tone === 'danger'
                                  ? 'text-danger'
                                  : d.tone === 'ok'
                                    ? 'text-success-soft'
                                    : ''
                            }
                          >
                            {d.dot ? <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" /> : null}
                            {d.text}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <QtyStepper
                  value={quantity}
                  hidden={!isAvailable}
                  onMinus={() => updateQuantity(tier.id, -1)}
                  onPlus={() => updateQuantity(tier.id, 1)}
                  plusDisabled={quantity >= available}
                  decreaseLabel={`${t('events.decrease_quantity', { defaultValue: 'Decrease quantity' })}, ${tier.name}`}
                  increaseLabel={`${t('events.increase_quantity', { defaultValue: 'Increase quantity' })}, ${tier.name}`}
                />
              </li>
            )
          })}
        </ul>
      </section>

      {/* Add-ons, after the tickets (lib/addons/addOns.ts). */}
      {addOnList.length > 0 && totalTickets > 0 && !doorSelected && (
        <AddOnsPicker
          addOns={addOnList}
          soldMap={addOnsSold}
          cartTierIds={getSelections().map((s) => s.tierId)}
          quantities={addOnQty}
          onChange={setAddOnQty}
          currency={currency}
        />
      )}

      {/* Promo code: one quiet line until somebody wants it. */}
      {!promoOpen && !promoValidation?.valid ? (
        <button
          type="button"
          onClick={() => setPromoOpen(true)}
          disabled={!canPurchase}
          className="min-h-10 text-left text-meta text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          {t('events.promo_code_prompt', { defaultValue: 'Have a promo code?' })}
        </button>
      ) : (
        <div>
          <label htmlFor="promo-code" className="mb-1.5 block text-caption font-bold uppercase tracking-[0.07em] text-fg-muted">
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
              className="h-10 min-w-0 flex-1 rounded bg-surface px-3 text-base uppercase text-fg placeholder:text-fg-faint placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-brand-400/50 disabled:opacity-50"
            />
            <button
              onClick={validatePromoCode}
              disabled={!canPurchase || !promoCode.trim() || validatingPromo}
              className="h-10 shrink-0 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:bg-surface-raised disabled:text-fg-subtle disabled:cursor-not-allowed"
            >
              {validatingPromo ? '…' : t('events.apply')}
            </button>
          </div>
          {promoError && (
            <div className="mt-2 text-sm text-danger-soft" role="alert">
              {promoError}
            </div>
          )}
          {promoValidation?.valid && (
            <div className="mt-2 flex items-center gap-1 text-sm text-success">
              <span aria-hidden>✓</span>
              <span>{promoValidation.promoCode?.description || t('events.promo_code_applied')}</span>
            </div>
          )}
        </div>
      )}

      {/* Totals, like the app's footer: what is in the cart on the left, the
          one number to pay on the right. Discount and fee stay itemized above it. */}
      {totalTickets > 0 && (
        <div className="border-t border-line pt-3">
          {promoValidation?.valid && promoValidation.promoCode && orderPricing.discount > 0 && (
            <div className="flex justify-between text-meta text-success">
              <span>
                {t('events.promo_discount')} ({promoValidation.promoCode.code})
              </span>
              <span className="tabular-nums">-{formatMoney(orderPricing.discount, currency)}</span>
            </div>
          )}
          {showFeeLine && (
            <div className="flex justify-between text-meta text-fg-muted">
              <span>{t('checkout.service_fee', { defaultValue: 'Service fee' })}</span>
              <span className="tabular-nums">{formatMoney(orderPricing.buyerFee, currency)}</span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lead font-semibold text-fg">
                {isFreeOrder && doorDue > 0
                  ? t('events.due_at_door', { defaultValue: 'Due at the door' })
                  : totalTickets === 1
                    ? te('addOns.buyer.ticketsOne', { defaultValue: '1 ticket' })
                    : te('addOns.buyer.ticketsOther', { defaultValue: '{{count}} tickets', count: totalTickets })}
              </div>
              {addOnCount > 0 && (
                <div className="text-caption text-brand-400">
                  {addOnCount === 1
                    ? te('addOns.buyer.itemsOne', { defaultValue: '+ 1 add-on' })
                    : te('addOns.buyer.itemsOther', { defaultValue: '+ {{count}} add-ons', count: addOnCount })}
                </div>
              )}
            </div>
            <div className="shrink-0 text-headline font-bold tabular-nums text-fg">
              {isFreeOrder && doorDue > 0
                ? doorMoney(doorDue, currency, i18n.language)
                : orderPricing.total === 0
                  ? t('common.free')
                  : formatMoney(orderPricing.total, currency)}
            </div>
          </div>
          {showFeeLine && (
            <div className="mt-1 text-caption text-fg-subtle">
              {t('checkout.total_includes_fees', {
                defaultValue: 'Total includes all fees. This is what you pay.',
              })}{' '}
              {t('checkout.service_fee_nonrefundable', {
                defaultValue: 'Service fee is non-refundable unless the event is cancelled.',
              })}
            </div>
          )}
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={!canPurchase || totalTickets === 0}
        className="h-12 w-full rounded bg-inverse px-6 font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:bg-surface-raised disabled:text-fg-subtle disabled:cursor-not-allowed"
      >
        {!canPurchase
          ? t('events.sign_in_to_purchase')
          : totalTickets === 0
          ? t('events.select_tickets')
          : isFreeOrder && doorDue > 0
          ? totalTickets === 1
            ? t('events.reserve_spot', { defaultValue: 'Reserve a spot' })
            : t('events.reserve_spots', { defaultValue: 'Reserve {{count}} spots', count: totalTickets })
          : isFreeOrder
          ? totalTickets === 1
            ? t('events.get_free_ticket', { defaultValue: 'Get free ticket' })
            : t('events.get_free_tickets', { defaultValue: 'Get free tickets' })
          : `${t('events.checkout')} · ${formatMoney(orderPricing.total, currency)}`
        }
      </button>
    </div>
  )
}
