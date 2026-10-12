type AnyRecord = Record<string, any>

function toDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value

  // Firestore Timestamp-like
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    } catch {
      return null
    }
  }

  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

export function getPromoStartAt(promo: AnyRecord): Date | null {
  return toDate(promo?.valid_from)
}

export function getPromoExpiresAt(promo: AnyRecord): Date | null {
  // Canonical field used in the organizer UI
  const exp = toDate(promo?.expires_at)
  if (exp) return exp

  // Legacy field used by some API routes
  return toDate(promo?.valid_until)
}

export function getPromoUsesCount(promo: AnyRecord): number {
  const uses = promo?.uses_count ?? promo?.times_used ?? 0
  const n = Number(uses)
  return Number.isFinite(n) ? n : 0
}

export function isPromoActive(promo: AnyRecord): boolean {
  // Treat missing field as active.
  const v = promo?.is_active
  if (v === undefined || v === null) return true
  return Boolean(v)
}

export function promoDiscountFields(promo: AnyRecord): {
  discount_percentage?: number
  discount_amount?: number
  discountType: 'percentage' | 'fixed'
  discountValue: number
} {
  const rawType = String(promo?.discount_type || '').toLowerCase()
  const rawValue = Number(promo?.discount_value)
  const discountValue = Number.isFinite(rawValue) ? rawValue : 0

  const normalizedType: 'percentage' | 'fixed' =
    rawType === 'percentage' ? 'percentage' : 'fixed'

  if (normalizedType === 'percentage') {
    return {
      discountType: 'percentage',
      discountValue,
      discount_percentage: discountValue,
    }
  }

  return {
    discountType: 'fixed',
    discountValue,
    discount_amount: discountValue,
  }
}

export interface DiscountInput {
  discount_type: 'percentage' | 'fixed_amount' | 'fixed' | string
  discount_value: number
}

/**
 * A promo's discount on ONE ticket's price. Applied per ticket by every paid
 * initiator (card, MonCash, Sogepay) and the free-claim route, so a fixed-amount
 * code takes its amount off each ticket, never once off the order. Pure — the
 * web checkout calls it too, so the total it shows is the total charged.
 */
export function calculateDiscount(
  originalPrice: number,
  promoCode: DiscountInput
): { discountedPrice: number; discountAmount: number } {
  let discountAmount = 0

  if (promoCode.discount_type === 'percentage') {
    discountAmount = (originalPrice * promoCode.discount_value) / 100
  } else {
    // 'fixed_amount' | 'fixed' | anything else → flat amount off
    discountAmount = promoCode.discount_value
  }

  // Guard rail: discount can never exceed the price (integer-cents-safe callers
  // compute cents downstream; here we keep the same rounding the app already used).
  discountAmount = Math.min(Math.max(0, discountAmount), originalPrice)

  const discountedPrice = Math.max(0, originalPrice - discountAmount)

  return {
    discountedPrice: Math.round(discountedPrice * 100) / 100, // Round to 2 decimals
    discountAmount: Math.round(discountAmount * 100) / 100,
  }
}
