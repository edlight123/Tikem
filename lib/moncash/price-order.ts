/**
 * What a MonCash order charges — shared by /api/moncash-button/initiate (which
 * takes the money) and /api/moncash-button/quote (which shows the buyer the HTG
 * figure first). One function, so the quote can never drift from the charge:
 * same tier validation, same promo application, same Haiti fee incidence
 * (a passed-on fee is added, an absorbed one is not), same USD→HTG conversion
 * with the spread, same per-unit rounding and the same sumMoney total.
 *
 * Pure apart from the injected rate lookup and the Firestore reads in
 * loadMonCashPricingDocs. Nothing here writes.
 */
import { calculateDiscount } from '@/lib/promo-codes'
import {
  convertUsdToHtgAmount,
  FX_RATE_UNAVAILABLE_CODE,
  FX_UNAVAILABLE_MESSAGES,
  getUsdToHtgRateWithSpread,
  isFxRateUnavailableError,
  sumMoney,
  type UsdHtgRateSource,
  type UsdToHtgRateResult,
} from '@/lib/fx/usd-htg'
import {
  checkTierForEvent,
  invalidQuantityRefusal,
  normalizeTierLines,
  parseTicketQuantity,
  pickTierWhenUnspecified,
} from '@/lib/tickets/purchasable'
import { priceOrderCents } from '@/lib/checkout/buyer-pricing'
import { fromCents } from '@/lib/ticketPricing'

export type TierSelection = { tierId: string; quantity: number }

export type PricingRefusal = { ok: false; status: number; error: string; code?: string }

/** The spread Tikèm keeps on a USD→HTG conversion of buyer money. */
export const MONCASH_USD_SPREAD = 0.05

export function tierIsOnSale(tier: any, now: Date): { ok: true } | { ok: false; reason: string } {
  if (tier?.is_active === false) return { ok: false, reason: 'This ticket tier is not available.' }

  const salesStart = tier?.sales_start ? new Date(tier.sales_start) : null
  const salesEnd = tier?.sales_end ? new Date(tier.sales_end) : null

  if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
    return { ok: false, reason: 'Ticket sales for this tier have not started yet.' }
  }
  if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
    return { ok: false, reason: 'Ticket sales for this tier have ended.' }
  }

  const sold = Number(tier?.sold_quantity || 0)
  const total = Number(tier?.total_quantity || 0)
  const remaining = Math.max(0, total - sold)
  if (remaining <= 0) return { ok: false, reason: 'This ticket tier is sold out.' }

  return { ok: true }
}

export type OrderLines = {
  ok: true
  multiTier: boolean
  validSelections: TierSelection[]
  /** Single-line quantity (0 for a multi-tier order). */
  quantity: number
  requestedQuantity: number
}

/**
 * Quantities are whole numbers, 1..MAX_TICKETS_PER_ORDER, on every line. A
 * fractional quantity used to be charged pro rata (0.01 → 1% of a ticket) while
 * fulfillment's loop still issued a whole ticket, and 1.01 paid for one and got two.
 */
export function parseOrderLines(tiers: unknown, rawQuantity: unknown): OrderLines | PricingRefusal {
  const multiTier = Array.isArray(tiers) && tiers.length > 0
  if (multiTier) {
    const lines = normalizeTierLines(tiers as any)
    if (!lines.ok) return { ok: false, status: lines.status, error: lines.error, code: lines.code }
    if (lines.lines.length === 0) return { ok: false, status: 400, error: 'No valid ticket tiers selected' }
    return {
      ok: true,
      multiTier,
      validSelections: lines.lines,
      quantity: 0,
      requestedQuantity: lines.lines.reduce((sum, s) => sum + s.quantity, 0),
    }
  }
  const parsed = parseTicketQuantity(rawQuantity)
  if (parsed === null) {
    const refusal = invalidQuantityRefusal()
    return { ok: false, status: refusal.status, error: refusal.error, code: refusal.code }
  }
  return { ok: true, multiTier, validSelections: [], quantity: parsed, requestedQuantity: parsed }
}

export type PricingDocs = {
  tierDocs: any[]
  singleTier: any
  eventTiers: any[] | null
}

/** The tier reads pricing needs, issued together. */
export function loadMonCashPricingDocs(
  supabase: any,
  eventId: string,
  lines: Pick<OrderLines, 'multiTier' | 'validSelections'>,
  tierId?: string | null
): Promise<PricingDocs> {
  const readTier = (id: string) =>
    Promise.resolve(supabase.from('ticket_tiers').select('*').eq('id', id).single()).then(
      ({ data }: any) => data as any
    )
  return Promise.all([
    Promise.all(lines.validSelections.map((sel) => readTier(sel.tierId))),
    !lines.multiTier && tierId ? readTier(String(tierId)) : Promise.resolve(null),
    // No tierId on a single-line order: find out whether the event HAS tiers, so
    // the buyer cannot skip them by paying `event.ticket_price` (the lowest one).
    !lines.multiTier && !tierId
      ? Promise.resolve(supabase.from('ticket_tiers').select('*').eq('event_id', String(eventId))).then(
          ({ data }: any) => (Array.isArray(data) ? data : []) as any[]
        )
      : Promise.resolve(null),
  ]).then(([tierDocs, singleTier, eventTiers]) => ({ tierDocs, singleTier, eventTiers }))
}

export type FaceLine = { tierId: string | null; tierName: string; quantity: number; unitPrice: number }

export type FacePricing = {
  ok: true
  normalizedSelections: FaceLine[]
  totalQuantity: number
  originalCurrency: string
  /** Post-promo face total in the event currency. */
  originalAmount: number
  /** Total discount across the order (event currency). */
  promoDiscountTotal: number
}

/** Validate the tiers and price the face value (event currency, promo applied). */
export function priceFaceSelections(input: {
  eventId: string
  event: any
  lines: OrderLines
  tierId?: string | null
  docs: PricingDocs
  promo: { discount_type: any; discount_value: number } | null
  now?: Date
}): FacePricing | PricingRefusal {
  const { eventId, event, lines, docs, promo } = input
  const now = input.now || new Date()
  let promoDiscountTotal = 0
  let normalizedSelections: FaceLine[] = []

  if (lines.multiTier) {
    for (let i = 0; i < lines.validSelections.length; i++) {
      const selection = lines.validSelections[i]
      const tier = docs.tierDocs[i]

      // Must exist, belong to THIS event, and be active — never skipped silently.
      const tierCheck = checkTierForEvent(tier, String(eventId))
      if (!tierCheck.ok) return { ok: false, status: tierCheck.status, error: tierCheck.error, code: tierCheck.code }

      const onSale = tierIsOnSale(tier, now)
      if (!onSale.ok) return { ok: false, status: 400, error: onSale.reason }

      const sold = Number(tier.sold_quantity || 0)
      const total = Number(tier.total_quantity || 0)
      const remaining = Math.max(0, total - sold)
      if (selection.quantity > remaining) {
        return { ok: false, status: 400, error: `Only ${remaining} ticket(s) remaining for ${tier.name || 'this tier'}.` }
      }

      let unitPrice = tier.price
      if (promo) {
        const { discountedPrice, discountAmount } = calculateDiscount(unitPrice, promo)
        unitPrice = discountedPrice
        promoDiscountTotal += discountAmount * selection.quantity
      }

      normalizedSelections.push({
        tierId: selection.tierId,
        tierName: tier.name || 'Ticket',
        quantity: selection.quantity,
        unitPrice,
      })
    }

    if (normalizedSelections.length === 0) {
      return { ok: false, status: 400, error: 'No valid ticket tiers selected' }
    }
  } else {
    // Single-tier (or event base price)
    const quantity = lines.quantity
    let unitPrice = event.ticket_price
    let tierName = 'General Admission'
    let resolvedTierId: string | null = null

    let tier: any = null
    if (input.tierId) {
      const tierCheck = checkTierForEvent(docs.singleTier, String(eventId))
      if (!tierCheck.ok) return { ok: false, status: tierCheck.status, error: tierCheck.error, code: tierCheck.code }
      tier = docs.singleTier
    } else {
      const picked = pickTierWhenUnspecified(docs.eventTiers, String(eventId))
      if (!picked.ok) return { ok: false, status: picked.status, error: picked.error, code: picked.code }
      tier = picked.tier
    }

    if (tier) {
      const onSale = tierIsOnSale(tier, now)
      if (!onSale.ok) return { ok: false, status: 400, error: onSale.reason }

      const sold = Number(tier.sold_quantity || 0)
      const total = Number(tier.total_quantity || 0)
      const remaining = Math.max(0, total - sold)
      if (quantity > remaining) {
        return { ok: false, status: 400, error: `Only ${remaining} ticket(s) remaining for this tier.` }
      }

      unitPrice = tier.price
      tierName = tier.name
      resolvedTierId = tier.id
    }

    if (promo) {
      const { discountedPrice, discountAmount } = calculateDiscount(unitPrice, promo)
      unitPrice = discountedPrice
      promoDiscountTotal += discountAmount * quantity
    }

    normalizedSelections = [{ tierId: resolvedTierId, tierName, quantity, unitPrice }]
  }

  return {
    ok: true,
    normalizedSelections,
    totalQuantity: normalizedSelections.reduce((sum, s) => sum + s.quantity, 0),
    originalCurrency: String(event.currency || 'HTG').toUpperCase(),
    originalAmount: sumMoney(normalizedSelections.map((s) => s.quantity * s.unitPrice)),
    promoDiscountTotal,
  }
}

export type ChargeLine = FaceLine & { originalUnitPrice?: number }

export type ExchangeRateRecord = {
  used: number
  base: number
  spreadPercent: number
  provider: string
  fetchedAt: string
  source: UsdHtgRateSource
}

export type MonCashCharge = {
  ok: true
  chargeCurrency: string
  chargeSelections: ChargeLine[]
  /** Face value in the charge currency (before any passed-on fee). */
  faceChargeAmount: number
  /** What the gateway is asked to collect. */
  chargeAmount: number
  feeIncidence: 'buyer' | 'organizer'
  buyerFeeOriginal: number
  buyerFeeCharged: number
  /** Null for an HTG event (no conversion). */
  exchange: ExchangeRateRecord | null
}

/**
 * MonCash settles in HTG. A USD event is converted with the hardened rate +
 * spread, per unit; then the organizer's absorb/pass-on choice is applied the
 * same way create-payment-intent prices it (lib/checkout/buyer-pricing, the
 * STORED Haiti rate, no cap) on the post-promo face total in the event currency.
 */
export async function priceMonCashCharge(input: {
  event: any
  face: FacePricing
  /** platformSettings.haiti — the stored rate. */
  feeConfig: any
  lang?: 'en' | 'fr' | 'ht'
  getRate?: () => Promise<UsdToHtgRateResult>
}): Promise<MonCashCharge | PricingRefusal> {
  const { event, face } = input
  const { originalCurrency, originalAmount, normalizedSelections, totalQuantity } = face

  let chargeCurrency = originalCurrency
  let chargeSelections: ChargeLine[] = normalizedSelections
  let chargeAmount = originalAmount
  let exchange: ExchangeRateRecord | null = null

  if (originalCurrency === 'USD') {
    let rate: UsdToHtgRateResult
    try {
      rate = await (input.getRate || (() => getUsdToHtgRateWithSpread({ spreadPercent: MONCASH_USD_SPREAD })))()
    } catch (err) {
      if (isFxRateUnavailableError(err)) {
        return {
          ok: false,
          status: 503,
          code: FX_RATE_UNAVAILABLE_CODE,
          error: FX_UNAVAILABLE_MESSAGES[input.lang || 'en'],
        }
      }
      throw err
    }
    exchange = {
      used: rate.effectiveRate,
      base: rate.baseRate,
      spreadPercent: rate.spreadPercent,
      provider: rate.provider,
      fetchedAt: rate.fetchedAtIso,
      source: rate.source,
    }
    chargeCurrency = 'HTG'
    chargeSelections = normalizedSelections.map((s) => ({
      ...s,
      originalUnitPrice: s.unitPrice,
      unitPrice: convertUsdToHtgAmount(s.unitPrice, rate.effectiveRate),
    }))
    chargeAmount = sumMoney(chargeSelections.map((s) => s.quantity * s.unitPrice))
  } else if (originalCurrency !== 'HTG') {
    return {
      ok: false,
      status: 400,
      error: `MonCash only supports HTG. Event currency ${originalCurrency} is not supported for MonCash.`,
    }
  }

  const buyerPricing = priceOrderCents(Math.round(originalAmount * 100), event, {
    quantity: totalQuantity,
    currency: originalCurrency,
    config: input.feeConfig,
  })
  const feeIncidence: 'buyer' | 'organizer' =
    buyerPricing.incidence === 'buyer' && buyerPricing.buyerFee > 0 ? 'buyer' : 'organizer'
  const buyerFeeOriginal = feeIncidence === 'buyer' ? fromCents(buyerPricing.buyerFee) : 0
  let buyerFeeCharged = 0
  if (buyerFeeOriginal > 0) {
    buyerFeeCharged = exchange ? convertUsdToHtgAmount(buyerFeeOriginal, exchange.used) : buyerFeeOriginal
  }
  const faceChargeAmount = chargeAmount
  chargeAmount = sumMoney([faceChargeAmount, buyerFeeCharged])

  return {
    ok: true,
    chargeCurrency,
    chargeSelections,
    faceChargeAmount,
    chargeAmount,
    feeIncidence,
    buyerFeeOriginal,
    buyerFeeCharged,
    exchange,
  }
}
