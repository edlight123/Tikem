/**
 * Event Earnings Management
 * 
 * Handles calculation, tracking, and updating of organizer earnings
 */

import { adminDb } from '@/lib/firebase/admin'
import { calculateFees, calculateSettlementDate, isSettlementReady, calculatePlatformFeeWithPercentage, calculateSettlementDateWithHoldDays } from '@/lib/fees'
import type { EventEarnings, SettlementStatus, EarningsSummary } from '@/types/earnings'
import { getEventLocation } from '@/types/platform-settings'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { getFundedCommissionForEvent } from '@/lib/promoters'

type PaymentMethod = 'stripe' | 'stripe_connect' | 'moncash' | 'moncash_button' | 'natcash' | 'sogepay' | 'unknown'

/** Who paid the platform+processing fee on an order. Stamped per ticket at purchase. */
type FeeIncidence = 'organizer' | 'buyer'

function toDateOrNull(value: any): Date | null {
  if (!value) return null
  const raw = value?.toDate ? value.toDate() : value
  const date = raw instanceof Date ? raw : new Date(raw)
  return isNaN(date.getTime()) ? null : date
}

function normalizeCurrency(raw: unknown): 'HTG' | 'USD' | 'CAD' | 'EUR' {
  const upper = String(raw || '').toUpperCase()
  if (upper === 'USD') return 'USD'
  if (upper === 'CAD') return 'CAD'
  if (upper === 'EUR') return 'EUR'
  return 'HTG'
}

function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const value = String(raw || '').toLowerCase()
  if (value === 'stripe') return 'stripe'
  if (value === 'stripe_connect') return 'stripe_connect'
  if (value === 'moncash_button') return 'moncash_button'
  if (value === 'moncash') return 'moncash'
  if (value === 'natcash') return 'natcash'
  if (value === 'sogepay') return 'sogepay'
  return 'unknown'
}

/**
 * MonCash keeps 2% of every collection before it reaches Tikèm's merchant
 * account (measured: a 25 HTG sale landed as 24.50). The platform fee is
 * all-in for organizers, so this is Tikèm's cost, recorded as
 * absorbedProcessingFees and never deducted from the organizer's net.
 */
export const MONCASH_COLLECTION_FEE_RATE = 0.02

/**
 * The MonCash fee is taken on the HTG actually charged; express it in the
 * event's currency (fxRate is charged-per-event, so divide).
 */
function moncashAbsorbedFeeEventCents(options: {
  grossEventCents: number
  paymentMethod: PaymentMethod
  chargedAmountCents?: number | null
  fxRate?: number | null
}): number {
  if (options.paymentMethod !== 'moncash' && options.paymentMethod !== 'moncash_button') return 0
  const charged = Math.max(0, Math.round(options.chargedAmountCents ?? options.grossEventCents))
  const feeChargedCents = Math.round(charged * MONCASH_COLLECTION_FEE_RATE)
  const fx = typeof options.fxRate === 'number' && Number.isFinite(options.fxRate) && options.fxRate > 0
    ? options.fxRate
    : null
  return fx ? Math.round(feeChargedCents / fx) : feeChargedCents
}

function calculateEventCurrencyFees(options: {
  grossEventCents: number
  paymentMethod: PaymentMethod
  chargedAmountCents?: number | null
  fxRate?: number | null
  platformFeePercentage?: number
  feeIncidence?: FeeIncidence
}): { grossAmount: number; platformFee: number; processingFee: number; netAmount: number; absorbedProcessingFee: number } {
  const grossEventCents = Math.max(0, Math.round(options.grossEventCents || 0))
  if (grossEventCents <= 0) {
    return { grossAmount: 0, platformFee: 0, processingFee: 0, netAmount: 0, absorbedProcessingFee: 0 }
  }
  // MonCash takes its cut whoever bears the platform fee.
  const absorbedProcessingFee = moncashAbsorbedFeeEventCents({ ...options, grossEventCents })

  // Buyer incidence (US / Canada / France): the buyer was charged the fee ON TOP
  // of the face value and the organizer's Stripe transfer is the face value
  // exactly, so there is nothing left to deduct here. Deducting anyway is what
  // made a US organizer's net read ~13% below what they actually receive.
  // The flag is stamped per ticket at purchase, so tickets sold under the old
  // model keep their old arithmetic.
  if (options.feeIncidence === 'buyer') {
    return {
      grossAmount: grossEventCents,
      platformFee: 0,
      processingFee: 0,
      netAmount: grossEventCents,
      absorbedProcessingFee,
    }
  }

  // Platform fee is always calculated on organizer-facing gross (event currency).
  // Use dynamic fee percentage if provided, otherwise use default from calculateFees
  const platformFee = options.platformFeePercentage !== undefined
    ? calculatePlatformFeeWithPercentage(grossEventCents, options.platformFeePercentage)
    : calculateFees(grossEventCents).platformFee

  // Processing fee depends on the payment rail.
  // Stripe fees are in charged/settlement currency, so convert them back to event currency when needed.
  let processingFeeEventCents = 0
  if (options.paymentMethod === 'stripe' || options.paymentMethod === 'stripe_connect') {
    const charged = Math.max(0, Math.round(options.chargedAmountCents ?? grossEventCents))
    const stripeFees = calculateFees(charged)
    const stripeProcessingFeeChargedCents = stripeFees.processingFee
    const fx = typeof options.fxRate === 'number' && Number.isFinite(options.fxRate) && options.fxRate > 0
      ? options.fxRate
      : null

    // fxRate is settlement-per-event (e.g., USD per HTG for Stripe HTG events).
    // Convert charged-currency processing fee back to event currency.
    processingFeeEventCents = fx ? Math.round(stripeProcessingFeeChargedCents / fx) : stripeProcessingFeeChargedCents
  }

  // Card processing is Tikèm's cost, paid out of the platform fee — the same
  // treatment MonCash's cut already gets — so it is never deducted here.
  const netAmount = grossEventCents - platformFee
  return {
    grossAmount: grossEventCents,
    platformFee,
    processingFee: 0,
    netAmount,
    absorbedProcessingFee: absorbedProcessingFee + processingFeeEventCents,
  }
}

async function findEventEarningsDoc(eventId: string) {
  // Current schema: eventId field.
  const byEventId = await adminDb
    .collection('event_earnings')
    .where('eventId', '==', eventId)
    .limit(1)
    .get()
  if (!byEventId.empty) return byEventId.docs[0]

  // Legacy schema: event_id field.
  const byLegacyEventId = await adminDb
    .collection('event_earnings')
    .where('event_id', '==', eventId)
    .limit(1)
    .get()
  if (!byLegacyEventId.empty) return byLegacyEventId.docs[0]

  // Some deployments may have used the eventId as the doc id.
  const byDocId = await adminDb.collection('event_earnings').doc(eventId).get()
  if (byDocId.exists) return byDocId

  return null
}

async function deriveEventEarningsFromTickets(eventId: string): Promise<EventEarnings | null> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return null

  const event = eventDoc.data() || {}
  
  // Get event location to determine which fees to use
  const eventCountry = String(event.country || 'HT')
  const eventLocation = getEventLocation(eventCountry)
  
  // Fetch dynamic platform settings
  const platformSettings = await getPlatformSettings()
  const platformFeePercentage = eventLocation === 'haiti'
    ? platformSettings.haiti.platformFeePercentage
    : platformSettings.usCanada.platformFeePercentage
  const settlementHoldDays = eventLocation === 'haiti'
    ? platformSettings.haiti.settlementHoldDays
    : platformSettings.usCanada.settlementHoldDays
  
  // Settlement hold is applied after the event ends.
  const eventEndDate =
    toDateOrNull(event.end_datetime || event.endDateTime) ||
    toDateOrNull(event.start_datetime || event.startDateTime || event.date_time || event.date) ||
    toDateOrNull(event.created_at)
  if (!eventEndDate) return null

  const ticketsSnapshot = await adminDb.collection('tickets').where('event_id', '==', eventId).get()

  // Organizer-facing earnings should always be presented in the event's currency (listed/original currency).
  const eventCurrency = normalizeCurrency(event.currency || 'HTG')

  // Group by payment_id so fixed processing fee is applied once per purchase.
  const paymentGroups = new Map<
    string,
    {
      grossEventCents: number
      ticketCount: number
      paymentMethod: PaymentMethod
      fxRate: number | null
      chargedAmountCents: number
      feeIncidence: FeeIncidence
    }
  >()
  let ticketsSold = 0

  for (const ticketDoc of ticketsSnapshot.docs) {
    const ticket = ticketDoc.data() || {}
    // Accept both legacy "valid" and standard "confirmed" tickets.
    const status = String(ticket.status || '').toLowerCase()
    if (status && status !== 'valid' && status !== 'confirmed') continue

    const pricePaid = Number(ticket.price_paid ?? ticket.pricePaid ?? 0)
    const grossEventCents = Math.round(pricePaid * 100)
    if (!Number.isFinite(grossEventCents) || grossEventCents <= 0) continue

    const paymentMethod = normalizePaymentMethod(ticket.payment_method)
    const fxRate = ticket.exchange_rate_used != null ? Number(ticket.exchange_rate_used) : null

    // If charged amount/currency is explicitly recorded (newer data), use it.
    // Otherwise, infer best-effort based on payment method and exchange rate.
    const chargedAmountMajor = ticket.charged_amount != null ? Number(ticket.charged_amount) : null
    const chargedAmountCents = (() => {
      if (chargedAmountMajor != null && Number.isFinite(chargedAmountMajor) && chargedAmountMajor > 0) {
        return Math.round(chargedAmountMajor * 100)
      }
      if (paymentMethod === 'stripe' && fxRate && Number.isFinite(fxRate) && fxRate > 0) {
        // Stripe HTG events charge in USD: charged = event * fx
        return Math.round((grossEventCents / 100) * fxRate * 100)
      }
      if ((paymentMethod === 'moncash' || paymentMethod === 'moncash_button') && fxRate && Number.isFinite(fxRate) && fxRate > 0) {
        // MonCash USD events charge in HTG: charged = event * fx
        return Math.round((grossEventCents / 100) * fxRate * 100)
      }
      return grossEventCents
    })()

    // Absent on every ticket sold before the buyer-pays rollout, and on every
    // Haiti sale — both are organizer-paid, which is exactly the default.
    const feeIncidence: FeeIncidence =
      String(ticket.fee_incidence ?? ticket.feeIncidence ?? '') === 'buyer' ? 'buyer' : 'organizer'

    const paymentId = String(ticket.payment_id ?? ticket.paymentId ?? 'unknown')
    const current =
      paymentGroups.get(paymentId) ||
      ({
        grossEventCents: 0,
        ticketCount: 0,
        paymentMethod,
        fxRate: fxRate && Number.isFinite(fxRate) ? fxRate : null,
        chargedAmountCents: 0,
        feeIncidence,
      } as const)

    // Preserve first non-unknown payment method/fx.
    const methodToUse = current.paymentMethod !== 'unknown' ? current.paymentMethod : paymentMethod
    const fxToUse = current.fxRate ?? (fxRate && Number.isFinite(fxRate) ? fxRate : null)

    paymentGroups.set(paymentId, {
      grossEventCents: current.grossEventCents + grossEventCents,
      ticketCount: current.ticketCount + 1,
      paymentMethod: methodToUse,
      fxRate: fxToUse,
      chargedAmountCents: current.chargedAmountCents + chargedAmountCents,
      // One payment is one charge, so its tickets share an incidence. Should a
      // group ever disagree, take the fee-bearing reading: under-reporting an
      // organizer's net is recoverable, over-reporting it is not.
      feeIncidence:
        current.feeIncidence === 'buyer' && feeIncidence === 'buyer' ? 'buyer' : 'organizer',
    })

    ticketsSold += 1
  }

  if (ticketsSold === 0 || paymentGroups.size === 0) return null

  let grossSales = 0
  let platformFee = 0
  let processingFees = 0
  let absorbedProcessingFees = 0
  let netAmount = 0

  for (const group of Array.from(paymentGroups.values())) {
    const fees = calculateEventCurrencyFees({
      grossEventCents: group.grossEventCents,
      paymentMethod: group.paymentMethod,
      chargedAmountCents: group.chargedAmountCents,
      fxRate: group.fxRate,
      platformFeePercentage, // Pass dynamic platform fee
      feeIncidence: group.feeIncidence,
    })
    grossSales += fees.grossAmount
    platformFee += fees.platformFee
    processingFees += fees.processingFee
    absorbedProcessingFees += fees.absorbedProcessingFee
    netAmount += fees.netAmount
  }

  // Promoter commission on FUNDED sales is the promoter's money, not the
  // organizer's — the incremental write withholds it, so the derived view must
  // deduct the same amount or the two disagree the moment a promoter sells.
  const promoterCommission = await getFundedCommissionForEvent(eventId)
  netAmount = netAmount - promoterCommission

  const settlementReadyDate = calculateSettlementDateWithHoldDays(eventEndDate, settlementHoldDays).toISOString()
  const settlementStatus: SettlementStatus = isSettlementReady(settlementReadyDate) ? 'ready' : 'pending'
  const availableToWithdraw = settlementStatus === 'ready' ? Math.max(0, netAmount) : 0

  const currency = eventCurrency

  const nowIso = new Date().toISOString()
  return {
    id: `derived_${eventId}`,
    eventId,
    organizerId: String(event.organizer_id || event.organizerId || ''),
    dataSource: 'tickets_derived',
    grossSales,
    ticketsSold,
    platformFee,
    processingFees,
    absorbedProcessingFees,
    promoterCommission,
    netAmount,
    availableToWithdraw,
    withdrawnAmount: 0,
    settlementStatus,
    settlementReadyDate,
    currency,
    lastCalculatedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

/** Code returned when an event's stored earnings must be reviewed before any withdrawal. */
export const EARNINGS_CURRENCY_REVIEW_CODE = 'earnings_currency_review' as const

export const EARNINGS_CURRENCY_REVIEW_MESSAGE =
  "This event's earnings record needs a quick review by the Tikèm payouts team before it can be withdrawn. We've flagged it — no money has moved."

/**
 * A stored event_earnings row whose currency is not the event's.
 *
 * Such a row cannot be trusted for a debit, and cannot be safely repaired
 * automatically: addTicketToEarnings always adds event-currency amounts but
 * never rewrites `currency`, so the stored figures may be in the event currency
 * under a wrong label, or genuinely in another currency — nothing on the row
 * says which. Its withdrawnAmount carries the same ambiguity, so it can be
 * neither subtracted from a tickets-derived net nor converted. Every surface
 * therefore treats the balance as 0 and every debit refuses until an admin
 * corrects the row. A missing stored currency is not a mismatch (legacy rows
 * are in the event currency).
 */
export function storedEarningsCurrencyMismatch(
  storedCurrencyRaw: unknown,
  eventCurrencyRaw: unknown
): { storedCurrency: string; eventCurrency: string } | null {
  if (!storedCurrencyRaw) return null
  const storedCurrency = normalizeCurrency(storedCurrencyRaw)
  const eventCurrency = normalizeCurrency(eventCurrencyRaw || 'HTG')
  return storedCurrency === eventCurrency ? null : { storedCurrency, eventCurrency }
}

/**
 * Mark the stored row so an admin can find it (`currencyReview.status ==
 * 'needs_admin_review'`). Touches no money field. Best-effort.
 */
export async function flagEarningsCurrencyReview(eventId: string, context?: Record<string, unknown>): Promise<void> {
  try {
    const doc = await findEventEarningsDoc(eventId)
    if (!doc) return
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    const mismatch = storedEarningsCurrencyMismatch(
      (doc.data() as any)?.currency,
      eventDoc.exists ? (eventDoc.data() as any)?.currency : null
    )
    if (!mismatch) return
    await doc.ref.set(
      {
        currencyReview: {
          status: 'needs_admin_review',
          ...mismatch,
          flaggedAt: new Date().toISOString(),
          ...(context || {}),
        },
      },
      { merge: true }
    )
  } catch (e) {
    console.error('flagEarningsCurrencyReview failed', eventId, (e as any)?.message)
  }
}

/**
 * Get event earnings record (without creating if missing)
 * 
 * @param eventId - Event ID
 * @returns EventEarnings or null if not found
 */
export async function getEventEarnings(eventId: string): Promise<EventEarnings | null> {
  const doc = await findEventEarningsDoc(eventId)
  if (doc) {
    const stored = { id: doc.id, ...(doc.data() as any) } as EventEarnings
    ;(stored as any).dataSource = (stored as any).dataSource || 'event_earnings'

    // Normalize settlement readiness on read so mobile doesn't get stuck with stale values.
    // Respect locked state (used when balance has been fully withdrawn).
    if (stored.settlementStatus !== 'locked') {
      const eventDoc = await adminDb.collection('events').doc(eventId).get()
      const eventData = eventDoc.exists ? (eventDoc.data() as any) : null
      const eventEndDate =
        toDateOrNull(eventData?.end_datetime || eventData?.endDateTime) ||
        toDateOrNull(eventData?.start_datetime || eventData?.startDateTime || eventData?.date_time || eventData?.date) ||
        toDateOrNull(eventData?.created_at)

      // Some deployments may store settlementReadyDate as a Firestore Timestamp/Date.
      // Normalize to ISO to avoid Invalid Date comparisons that keep status stuck at pending.
      // Prefer the earliest of (stored, computed-from-event-end) so legacy 7-day holds don't block
      // availability after switching to instant settlement.
      const storedReadyDate = toDateOrNull((stored as any).settlementReadyDate)
      const computedFromEventEnd = eventEndDate ? calculateSettlementDate(eventEndDate) : null
      const chosen = (() => {
        if (storedReadyDate && computedFromEventEnd) {
          return storedReadyDate.getTime() <= computedFromEventEnd.getTime() ? storedReadyDate : computedFromEventEnd
        }
        return storedReadyDate || computedFromEventEnd
      })()

      const computedSettlementReadyDate = chosen ? chosen.toISOString() : null

      if (computedSettlementReadyDate) {
        const computedStatus: SettlementStatus = isSettlementReady(computedSettlementReadyDate) ? 'ready' : 'pending'
        const withdrawnAmount = Math.max(0, Number((stored as any).withdrawnAmount || 0) || 0)
        const netAmount = Math.max(0, Number((stored as any).netAmount || 0) || 0)
        const computedAvailable =
          computedStatus === 'ready' ? Math.max(0, netAmount - withdrawnAmount) : 0

        ;(stored as any).settlementReadyDate = computedSettlementReadyDate
        ;(stored as any).settlementStatus = computedStatus
        ;(stored as any).availableToWithdraw = computedAvailable
        ;(stored as any).withdrawnAmount = withdrawnAmount
        ;(stored as any).netAmount = netAmount
      }
    }

    // If stored currency disagrees with the event currency, show a derived view
    // from tickets (so an HTG event never displays Stripe's charged USD) — but
    // NEVER as a withdrawable balance. See storedEarningsCurrencyMismatch.
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    const eventCurrency = eventDoc.exists ? normalizeCurrency((eventDoc.data() as any)?.currency || 'HTG') : null

    const mismatch = eventCurrency ? storedEarningsCurrencyMismatch((stored as any)?.currency, eventCurrency) : null
    if (eventCurrency && mismatch) {
      const withdrawalBlocked = {
        code: EARNINGS_CURRENCY_REVIEW_CODE,
        storedCurrency: mismatch.storedCurrency,
        eventCurrency,
      } as const
      const derived = await deriveEventEarningsFromTickets(eventId)
      if (derived) {
        derived.id = stored.id
        // The stored figure, in the STORED currency's units — shown for history,
        // never subtracted from the derived (event-currency) net.
        derived.withdrawnAmount = Math.max(0, Number((stored as any).withdrawnAmount || 0) || 0)
        derived.availableToWithdraw = 0
        derived.currency = eventCurrency
        derived.withdrawalBlocked = withdrawalBlocked
        ;(derived as any).dataSource = 'tickets_derived'
        return derived
      }

      // No tickets to derive from; at least align display currency to event currency.
      return {
        ...stored,
        currency: eventCurrency,
        availableToWithdraw: 0,
        withdrawalBlocked,
        dataSource: (stored as any).dataSource || 'event_earnings',
      } as EventEarnings
    }

    return stored
  }

  // Fallback for legacy data: compute a best-effort view from tickets.
  return deriveEventEarningsFromTickets(eventId)
}

export type EventTierSalesBreakdownRow = {
  tierId: string | null
  tierName: string
  listedUnitPriceCents: number
  listedCurrency: 'HTG' | 'USD' | 'CAD' | 'EUR'
  ticketsSold: number
  grossSales: number
}

export async function getEventTierSalesBreakdown(eventId: string): Promise<EventTierSalesBreakdownRow[]> {
  const tiers = new Map<string, EventTierSalesBreakdownRow>()

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  const eventCurrency = eventDoc.exists ? normalizeCurrency((eventDoc.data() as any)?.currency || 'HTG') : 'HTG'

  const normalizeTierName = (value: unknown) => {
    const name = String(value || '').trim()
    return name.length > 0 ? name : 'General Admission'
  }

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null

  while (true) {
    let queryRef = adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where('status', '==', 'confirmed')
      .orderBy('purchased_at', 'desc')
      .select(
        'tier_id',
        'tierId',
        'tier_name',
        'tierName',
        'ticket_type',
        'ticketType',
        'price_paid',
        'pricePaid',
        'currency',
        'original_currency',
        'quantity'
      )
      .limit(1000) as FirebaseFirestore.Query

    if (lastDoc) {
      queryRef = (queryRef as any).startAfter(lastDoc)
    }

    const snapshot = await queryRef.get()
    if (snapshot.empty) break

    for (const doc of snapshot.docs) {
      const data: any = doc.data() || {}

      const tierId = (data.tier_id || data.tierId || null) as string | null
      const tierName = normalizeTierName(data.tier_name || data.tierName || data.ticket_type || data.ticketType)

      // Prefer explicit original/listed currency; otherwise fall back to event currency.
      // Do NOT fall back to charged currency, which can be USD for HTG events.
      const listedCurrency = normalizeCurrency(data.original_currency || eventCurrency)

      const quantity = Math.max(1, Number(data.quantity || 1) || 1)
      const pricePaidMajor = Number(data.price_paid ?? data.pricePaid ?? 0) || 0
      const unitPriceCents = Math.max(0, Math.round(pricePaidMajor * 100))
      const grossSales = unitPriceCents * quantity

      const groupKey = `${String(tierId || tierName)}::${unitPriceCents}::${listedCurrency}`

      const existing = tiers.get(groupKey)
      if (existing) {
        existing.ticketsSold += quantity
        existing.grossSales += grossSales
      } else {
        tiers.set(groupKey, {
          tierId,
          tierName,
          listedUnitPriceCents: unitPriceCents,
          listedCurrency,
          ticketsSold: quantity,
          grossSales,
        })
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.docs.length < 1000) break
  }

  return Array.from(tiers.values()).sort((a, b) => {
    const tierCompare = a.tierName.localeCompare(b.tierName)
    if (tierCompare !== 0) return tierCompare
    if (a.listedCurrency !== b.listedCurrency) return a.listedCurrency.localeCompare(b.listedCurrency)
    return a.listedUnitPriceCents - b.listedUnitPriceCents
  })
}

/**
 * Get or create event earnings record
 * 
 * @param eventId - Event ID
 * @returns EventEarnings document reference
 */
export async function getOrCreateEventEarnings(eventId: string): Promise<{
  ref: FirebaseFirestore.DocumentReference
  data: EventEarnings | null
}> {
  // Find the existing row with the SAME lookup getEventEarnings uses (eventId,
  // then legacy event_id, then doc id). Querying `eventId` alone here used to
  // miss a legacy row that the read path found, so a withdrawal was validated
  // against one document and debited from a freshly created empty one.
  const existing = await findEventEarningsDoc(eventId)
  if (existing) {
    return {
      ref: existing.ref,
      data: { id: existing.id, ...(existing.data() as any) } as EventEarnings,
    }
  }

  // Create new earnings record
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) {
    throw new Error(`Event ${eventId} not found`)
  }

  const event = eventDoc.data()!
  const eventEndDate =
    toDateOrNull((event as any).end_datetime || (event as any).endDateTime) ||
    toDateOrNull((event as any).start_datetime || (event as any).startDateTime || (event as any).date_time || (event as any).date) ||
    new Date()
  const settlementDate = calculateSettlementDate(eventEndDate)

  const newEarningsRef = adminDb.collection('event_earnings').doc()
  const newEarnings: Omit<EventEarnings, 'id'> = {
    eventId,
    organizerId: event.organizer_id,
    grossSales: 0,
    ticketsSold: 0,
    platformFee: 0,
    processingFees: 0,
    absorbedProcessingFees: 0,
    netAmount: 0,
    availableToWithdraw: 0,
    withdrawnAmount: 0,
    settlementStatus: 'pending',
    settlementReadyDate: settlementDate.toISOString(),
    currency: normalizeCurrency(event.currency || 'HTG'),
    lastCalculatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await newEarningsRef.set(newEarnings)

  return {
    ref: newEarningsRef,
    data: { id: newEarningsRef.id, ...newEarnings },
  }
}

/**
 * Update earnings when a ticket is purchased
 * Called from Stripe webhook after successful payment
 * 
 * @param eventId - Event ID
 * @param ticketAmount - Amount paid for ticket(s) in cents
 * @param quantity - Number of tickets purchased
 */
export async function addTicketToEarnings(
  eventId: string,
  ticketAmount: number,
  quantity: number = 1,
  options?: {
    currency?: string
    paymentMethod?: PaymentMethod | string
    chargedAmountCents?: number
    chargedCurrency?: string
    fxRate?: number | null
    /**
     * Who paid the fee on THIS order, from the payment's own metadata.
     * 'buyer' means the fee was charged on top and the organizer's transfer is
     * the face value exactly — nothing to deduct here. Absent means organizer
     * incidence (all pre-flag sales, and the MonCash/SogePay rails, which have
     * no buyer-pays pricing).
     */
    feeIncidence?: FeeIncidence | string
    /**
     * FUNDED promoter commission on this order (recordPromoterSale's result).
     * Withheld from the organizer's net — it is the promoter's money, payable
     * from their wallet once this event's funds release.
     */
    promoterCommissionCents?: number
  }
): Promise<void> {
  const { ref, data } = await getOrCreateEventEarnings(eventId)

  // Get event to determine location and dynamic settings
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  const event = eventDoc.exists ? eventDoc.data() : null
  const eventCountry = event ? String(event.country || 'HT') : 'HT'
  const eventLocation = getEventLocation(eventCountry)
  
  // Fetch dynamic platform settings
  const platformSettings = await getPlatformSettings()
  const platformFeePercentage = eventLocation === 'haiti'
    ? platformSettings.haiti.platformFeePercentage
    : platformSettings.usCanada.platformFeePercentage

  const paymentMethod = normalizePaymentMethod(options?.paymentMethod)
  const fxRate = options?.fxRate != null ? Number(options.fxRate) : null
  const chargedAmountCents = options?.chargedAmountCents

  const fees = calculateEventCurrencyFees({
    grossEventCents: ticketAmount,
    paymentMethod,
    chargedAmountCents,
    fxRate,
    platformFeePercentage, // Pass dynamic platform fee
    feeIncidence: options?.feeIncidence === 'buyer' ? 'buyer' : 'organizer',
  })

  // Promoter commission comes out of the organizer's net under BOTH incidences:
  // it is a share of the face value, which is theirs either way.
  const promoterCommissionCents = Math.max(0, Math.round(Number(options?.promoterCommissionCents) || 0))
  const netAfterCommission = fees.netAmount - promoterCommissionCents

  // Update earnings
  const updates: Partial<EventEarnings> = {
    grossSales: (data?.grossSales || 0) + fees.grossAmount,
    ticketsSold: (data?.ticketsSold || 0) + quantity,
    platformFee: (data?.platformFee || 0) + fees.platformFee,
    processingFees: (data?.processingFees || 0) + fees.processingFee,
    absorbedProcessingFees: (data?.absorbedProcessingFees || 0) + fees.absorbedProcessingFee,
    promoterCommission: (data?.promoterCommission || 0) + promoterCommissionCents,
    netAmount: (data?.netAmount || 0) + netAfterCommission,
    availableToWithdraw: (data?.availableToWithdraw || 0) + netAfterCommission,
    lastCalculatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await ref.update(updates)

  console.log(`✅ Updated earnings for event ${eventId}:`, {
    ticketAmount: fees.grossAmount,
    netAdded: fees.netAmount,
    newTotal: updates.grossSales,
  })
}

/**
 * Process withdrawal from event earnings
 * Decreases availableToWithdraw and increases withdrawnAmount
 * 
 * @param eventId - Event ID
 * @param amount - Amount to withdraw in cents
 * @param payoutId - Payout request ID for tracking
 * @returns Success status
 */
export async function withdrawFromEarnings(
  eventId: string,
  amount: number,
  payoutId: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  const { ref, data } = await getOrCreateEventEarnings(eventId)

  if (!data) {
    return { success: false, error: 'Earnings not found' }
  }

  // Never debit a row whose units are ambiguous (see storedEarningsCurrencyMismatch).
  // getEventEarnings reports its balance as 0, so the callers' validation and
  // this debit agree; this is the backstop for any caller that skipped it.
  const eventForCurrency = await adminDb.collection('events').doc(eventId).get()
  const eventCurrencyRaw = eventForCurrency.exists ? (eventForCurrency.data() as any)?.currency : null
  if (storedEarningsCurrencyMismatch((data as any).currency, eventCurrencyRaw)) {
    return { success: false, error: EARNINGS_CURRENCY_REVIEW_MESSAGE, code: EARNINGS_CURRENCY_REVIEW_CODE }
  }

  const netAmount = Math.max(0, Number((data as any).netAmount || 0) || 0)
  const withdrawnAmount = Math.max(0, Number((data as any).withdrawnAmount || 0) || 0)

  // Recompute settlement/availability on demand so policy changes (e.g. hold days -> 0)
  // take effect immediately, without waiting for cron to update stored docs.
  let effectiveSettlementStatus: SettlementStatus = data.settlementStatus
  let effectiveSettlementReadyDateIso: string | null = (data as any).settlementReadyDate || null
  let effectiveAvailableToWithdraw = Math.max(0, Number((data as any).availableToWithdraw || 0) || 0)

  if (data.settlementStatus !== 'locked') {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    const eventData = eventDoc.exists ? (eventDoc.data() as any) : null
    const eventEndDate =
      toDateOrNull(eventData?.end_datetime || eventData?.endDateTime) ||
      toDateOrNull(eventData?.start_datetime || eventData?.startDateTime || eventData?.date_time || eventData?.date) ||
      toDateOrNull(eventData?.created_at)

    const storedReadyDate = toDateOrNull((data as any).settlementReadyDate)
    const computedFromEventEnd = eventEndDate ? calculateSettlementDate(eventEndDate) : null

    const chosen = (() => {
      if (storedReadyDate && computedFromEventEnd) {
        return storedReadyDate.getTime() <= computedFromEventEnd.getTime() ? storedReadyDate : computedFromEventEnd
      }
      return storedReadyDate || computedFromEventEnd
    })()

    effectiveSettlementReadyDateIso = chosen ? chosen.toISOString() : null
    effectiveSettlementStatus =
      effectiveSettlementReadyDateIso && isSettlementReady(effectiveSettlementReadyDateIso) ? 'ready' : 'pending'

    effectiveAvailableToWithdraw =
      effectiveSettlementStatus === 'ready' ? Math.max(0, netAmount - withdrawnAmount) : 0

    const needsSync =
      (data as any).settlementReadyDate !== effectiveSettlementReadyDateIso ||
      data.settlementStatus !== effectiveSettlementStatus ||
      Number((data as any).availableToWithdraw || 0) !== effectiveAvailableToWithdraw ||
      Number((data as any).withdrawnAmount || 0) !== withdrawnAmount

    if (needsSync && effectiveSettlementReadyDateIso) {
      await ref.update({
        settlementReadyDate: effectiveSettlementReadyDateIso,
        settlementStatus: effectiveSettlementStatus,
        availableToWithdraw: effectiveAvailableToWithdraw,
        withdrawnAmount,
        netAmount,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  // Fail-fast on the recomputed settlement policy before opening a transaction.
  if (effectiveSettlementStatus !== 'ready') {
    return {
      success: false,
      error: `Funds not yet available. Settlement status: ${effectiveSettlementStatus}`,
    }
  }

  // Atomic debit: re-read availableToWithdraw INSIDE a transaction and decrement it there, so two
  // concurrent double-submits can't both pass the availability check and each debit the balance
  // (which would authorize a double payout). Firestore serializes transactions touching the same
  // doc, so the second attempt observes the reduced balance and is refused.
  try {
    const result = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const cur = snap.exists ? (snap.data() as any) : {}
      const available = Math.max(0, Number(cur?.availableToWithdraw || 0) || 0)
      const withdrawn = Math.max(0, Number(cur?.withdrawnAmount || 0) || 0)

      if (storedEarningsCurrencyMismatch(cur?.currency, eventCurrencyRaw)) {
        return {
          success: false,
          error: EARNINGS_CURRENCY_REVIEW_MESSAGE,
          code: EARNINGS_CURRENCY_REVIEW_CODE,
        } as { success: boolean; error?: string; code?: string }
      }

      if (available < amount) {
        return {
          success: false,
          error: `Insufficient funds. Available: ${available}, Requested: ${amount}`,
        } as { success: boolean; error?: string; code?: string }
      }

      const remaining = Math.max(0, available - amount)
      const newWithdrawn = withdrawn + amount
      tx.update(ref, {
        availableToWithdraw: remaining,
        withdrawnAmount: newWithdrawn,
        settlementStatus: remaining === 0 ? 'locked' : 'ready',
        updatedAt: new Date().toISOString(),
      })
      return { success: true } as { success: boolean; error?: string; code?: string }
    })

    if (result.success) {
      console.log(`✅ Withdrew ${amount} from event ${eventId} for payout ${payoutId}`)
    }
    return result
  } catch (err) {
    console.error(`❌ withdrawFromEarnings transaction failed for event ${eventId}:`, err)
    return { success: false, error: 'Failed to process withdrawal' }
  }
}

/**
 * Refund a ticket and update earnings
 * 
 * @param eventId - Event ID
 * @param ticketAmount - Amount to refund in cents
 * @param quantity - Number of tickets refunded
 */
export async function refundTicketFromEarnings(
  eventId: string,
  ticketAmount: number,
  quantity: number = 1
): Promise<void> {
  const { ref, data } = await getOrCreateEventEarnings(eventId)

  if (!data) {
    throw new Error('Earnings not found')
  }

  // Calculate fees that were charged
  const fees = calculateFees(ticketAmount)

  // Reverse the earnings
  const updates: Partial<EventEarnings> = {
    grossSales: Math.max(0, data.grossSales - fees.grossAmount),
    ticketsSold: Math.max(0, data.ticketsSold - quantity),
    platformFee: Math.max(0, data.platformFee - fees.platformFee),
    processingFees: Math.max(0, data.processingFees - fees.processingFee),
    netAmount: Math.max(0, data.netAmount - fees.netAmount),
    availableToWithdraw: Math.max(0, data.availableToWithdraw - fees.netAmount),
    lastCalculatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await ref.update(updates)

  console.log(`✅ Refunded ${ticketAmount} from event ${eventId}`)
}

/**
 * Update settlement status for an event
 * Called by cron job or manually
 * 
 * @param eventId - Event ID
 */
export async function updateSettlementStatus(eventId: string): Promise<SettlementStatus> {
  const { ref, data } = await getOrCreateEventEarnings(eventId)

  if (!data) {
    throw new Error('Earnings not found')
  }

  if (data.settlementStatus === 'locked') {
    return 'locked'
  }

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  const eventData = eventDoc.exists ? (eventDoc.data() as any) : null
  const eventEndDate =
    toDateOrNull(eventData?.end_datetime || eventData?.endDateTime) ||
    toDateOrNull(eventData?.start_datetime || eventData?.startDateTime || eventData?.date_time || eventData?.date) ||
    toDateOrNull(eventData?.created_at)

  const storedReadyDate = toDateOrNull((data as any).settlementReadyDate)
  const computedFromEventEnd = eventEndDate ? calculateSettlementDate(eventEndDate) : null
  const chosen = (() => {
    if (storedReadyDate && computedFromEventEnd) {
      return storedReadyDate.getTime() <= computedFromEventEnd.getTime() ? storedReadyDate : computedFromEventEnd
    }
    return storedReadyDate || computedFromEventEnd
  })()

  const effectiveReadyIso = chosen ? chosen.toISOString() : null
  const effectiveStatus: SettlementStatus =
    effectiveReadyIso && isSettlementReady(effectiveReadyIso) ? 'ready' : 'pending'

  if (effectiveStatus !== data.settlementStatus) {
    await ref.update({
      settlementStatus: effectiveStatus,
      ...(effectiveReadyIso ? { settlementReadyDate: effectiveReadyIso } : {}),
      updatedAt: new Date().toISOString(),
    })
    console.log(`✅ Event ${eventId} settlement status changed to '${effectiveStatus}'`)
  }

  return effectiveStatus
}

/**
 * Get earnings summary for an organizer
 * 
 * @param organizerId - Organizer user ID
 * @returns Summary of all earnings
 */
export async function getOrganizerEarningsSummary(
  organizerId: string
): Promise<EarningsSummary> {
  const earningsSnapshot = await adminDb
    .collection('event_earnings')
    .where('organizerId', '==', organizerId)
    .get()

  let totalGrossSales = 0
  let totalNetAmount = 0
  let totalAvailableToWithdraw = 0
  let totalWithdrawn = 0
  let totalPlatformFees = 0
  let totalProcessingFees = 0

  const totalsByCurrency: NonNullable<EarningsSummary['totalsByCurrency']> = {}
  const currenciesSeen = new Set<EventEarnings['currency']>()

  const events: EarningsSummary['events'] = []

  for (const doc of earningsSnapshot.docs) {
    const data = doc.data() as EventEarnings

    const cur = normalizeCurrency((data as any)?.currency)
    currenciesSeen.add(cur)

    const bucket = totalsByCurrency[cur] || {
      totalGrossSales: 0,
      totalNetAmount: 0,
      totalAvailableToWithdraw: 0,
      totalWithdrawn: 0,
      totalPlatformFees: 0,
      totalProcessingFees: 0,
    }

    const netAmount = Math.max(0, Number((data as any).netAmount || 0) || 0)
    const withdrawnAmount = Math.max(0, Number((data as any).withdrawnAmount || 0) || 0)

    // Get event details
    const eventDoc = await adminDb.collection('events').doc(data.eventId).get()
    const event = eventDoc.data()

    const eventEndDate =
      toDateOrNull((event as any)?.end_datetime || (event as any)?.endDateTime) ||
      toDateOrNull((event as any)?.start_datetime || (event as any)?.startDateTime || (event as any)?.date_time || (event as any)?.date) ||
      toDateOrNull((event as any)?.created_at)

    const storedReadyDate = toDateOrNull((data as any).settlementReadyDate)
    const computedFromEnd = eventEndDate ? calculateSettlementDate(eventEndDate) : null
    const chosen = (() => {
      if (storedReadyDate && computedFromEnd) {
        return storedReadyDate.getTime() <= computedFromEnd.getTime() ? storedReadyDate : computedFromEnd
      }
      return storedReadyDate || computedFromEnd
    })()

    const effectiveReadyIso = chosen ? chosen.toISOString() : null
    const effectiveSettlementStatus: SettlementStatus =
      data.settlementStatus === 'locked'
        ? 'locked'
        : effectiveReadyIso && isSettlementReady(effectiveReadyIso)
          ? 'ready'
          : 'pending'

    const effectiveAvailableToWithdraw =
      effectiveSettlementStatus === 'ready' ? Math.max(0, netAmount - withdrawnAmount) : 0

    totalGrossSales += data.grossSales
    totalNetAmount += netAmount
    totalAvailableToWithdraw += effectiveAvailableToWithdraw
    totalWithdrawn += withdrawnAmount
    totalPlatformFees += data.platformFee
    totalProcessingFees += data.processingFees

    bucket.totalGrossSales += data.grossSales
    bucket.totalNetAmount += netAmount
    bucket.totalAvailableToWithdraw += effectiveAvailableToWithdraw
    bucket.totalWithdrawn += withdrawnAmount
    bucket.totalPlatformFees += data.platformFee
    bucket.totalProcessingFees += data.processingFees
    totalsByCurrency[cur] = bucket

    const eventDateRaw = (event as any)?.start_datetime || (event as any)?.date_time || (event as any)?.date || (event as any)?.created_at || ''
    const eventDate = (eventDateRaw as any)?.toDate ? (eventDateRaw as any).toDate() : (eventDateRaw ? new Date(eventDateRaw) : null)
    const eventDateIso = eventDate && !isNaN(eventDate.getTime()) ? eventDate.toISOString() : ''

    events.push({
      eventId: data.eventId,
      eventTitle: event?.title || 'Unknown Event',
      eventDate: eventDateIso,
      grossSales: data.grossSales,
      netAmount,
      availableToWithdraw: effectiveAvailableToWithdraw,
      settlementStatus: effectiveSettlementStatus,
      currency: cur,
    })
  }

  const currency: EarningsSummary['currency'] =
    currenciesSeen.size <= 1 ? (Array.from(currenciesSeen)[0] || 'HTG') : 'mixed'

  return {
    totalGrossSales,
    totalNetAmount,
    totalAvailableToWithdraw,
    totalWithdrawn,
    totalPlatformFees,
    totalProcessingFees,
    currency,
    totalsByCurrency: currency === 'mixed' ? totalsByCurrency : undefined,
    events: events.sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime()),
  }
}

/**
 * Get available events for withdrawal
 * Returns events with settlement status 'ready' and available balance > 0
 * 
 * @param organizerId - Organizer user ID
 * @returns List of events with withdrawable funds
 */
export async function getWithdrawableEvents(organizerId: string): Promise<EventEarnings[]> {
  const earningsSnapshot = await adminDb
    .collection('event_earnings')
    .where('organizerId', '==', organizerId)
    .where('settlementStatus', '==', 'ready')
    .get()

  const withdrawable: EventEarnings[] = []

  for (const doc of earningsSnapshot.docs) {
    const data = { id: doc.id, ...doc.data() } as EventEarnings

    if (data.availableToWithdraw > 0) {
      withdrawable.push(data)
    }
  }

  return withdrawable
}
