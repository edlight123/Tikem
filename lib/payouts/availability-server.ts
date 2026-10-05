/**
 * Firestore loader for lib/payouts/availability.ts.
 *
 * Gathers the facts — event, tickets, fee rule, promoter commission, the
 * per-event ledger's withdrawals, batch payouts, review status and the release
 * ladder context — and hands them to the pure computeEventAvailability(). Every
 * screen that shows an "available" figure and every route that validates a
 * withdrawal calls THESE functions, so the number shown is the number judged.
 *
 * Read-only: nothing here writes.
 */

import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDoc, storedEarningsCurrencyMismatch } from '@/lib/earnings'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { getFundedCommissionForEvent } from '@/lib/promoters'
import { getEventLocation, type PlatformSettings } from '@/types/platform-settings'
import { loadOrganizerReleaseContext, type OrganizerReleaseContext } from '@/lib/payouts/withdrawal-gate'
import { resolveConfig, type OrganizerHistory } from '@/lib/payouts/release-rules'
import {
  computeEventAvailability,
  normalizeCurrencyCode,
  summarizeAvailability,
  type BatchPayout,
  type CurrencyTotals,
  type EventAvailability,
  type FeeRule,
} from '@/lib/payouts/availability'

/** The rate and per-ticket cap checkout applies to this event (stored settings). */
export function feeRuleForEvent(event: any, settings: Pick<PlatformSettings, 'haiti' | 'usCanada'>): FeeRule {
  const location = getEventLocation(String(event?.country || 'HT'))
  const cfg = location === 'haiti' ? settings.haiti : settings.usCanada
  const currency = normalizeCurrencyCode(event?.currency)
  const table = cfg?.platformFeeCapMinorByCurrency || {}
  const capRaw = Object.prototype.hasOwnProperty.call(table, currency) ? Number(table[currency]) : null
  const rate = Number(cfg?.platformFeePercentage)
  return {
    // A corrupt stored rate must not price payouts; checkout discards it the same way.
    platformFeePercentage: Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : 0.1,
    capMinorPerTicket: capRaw !== null && Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : null,
  }
}

/** Every batch payout this organizer has ever requested (organizers/{id}/payouts). */
export async function loadBatchPayouts(organizerId: string): Promise<BatchPayout[]> {
  if (!organizerId) return []
  const snap = await adminDb.collection('organizers').doc(organizerId).collection('payouts').get()
  return snap.docs.map((doc: any) => {
    const d = doc.data() || {}
    return {
      id: doc.id,
      status: String(d.status || 'pending'),
      ticketIds: Array.isArray(d.ticketIds) ? d.ticketIds.map(String) : [],
      eventAmounts: d.eventAmounts && typeof d.eventAmounts === 'object' ? d.eventAmounts : null,
      debitedEventEarnings: d.debitedEventEarnings === true,
    }
  })
}

/** What an organizer-level call loads once and shares across events. */
export type OrganizerAvailabilityContext = {
  organizerId: string
  settings: PlatformSettings
  releaseContext: OrganizerReleaseContext
  batchPayouts: BatchPayout[]
}

export async function loadOrganizerAvailabilityContext(
  organizerId: string,
  now: Date = new Date()
): Promise<OrganizerAvailabilityContext> {
  const [settings, releaseContext, batchPayouts] = await Promise.all([
    getPlatformSettings(),
    loadOrganizerReleaseContext(organizerId, now),
    loadBatchPayouts(organizerId),
  ])
  return { organizerId, settings, releaseContext, batchPayouts }
}

/**
 * The same OrganizerHistory buildReleaseInputs() assembles in the gate — kept
 * field-for-field identical so the screen and the gate judge the same tier.
 */
function historyFor(ctx: OrganizerReleaseContext, eventId: string, currency: string): OrganizerHistory {
  return {
    completedEvents: Math.max(0, ctx.endedEventIds.size - (ctx.endedEventIds.has(eventId) ? 1 : 0)),
    lifetimeGrossMinor: Math.max(0, ctx.lifetimeGrossMinorByCurrency[currency.toUpperCase()] || 0),
    currency,
    preEventReleaseApproved: ctx.override?.preEventReleaseApproved === true,
    highRisk: ctx.override?.highRisk === true,
    forceEstablished: ctx.override?.forceEstablished === true,
  }
}

/**
 * Availability for ONE event. `eventData` may be passed when the caller has
 * already read (and authorised) the event. Returns null when the event does
 * not exist.
 */
export async function loadEventAvailability(args: {
  eventId: string
  eventData?: any
  context?: OrganizerAvailabilityContext
  now?: Date
}): Promise<EventAvailability | null> {
  const now = args.now || new Date()
  const eventId = String(args.eventId)

  let eventData = args.eventData
  if (!eventData) {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) return null
    eventData = eventDoc.data() || {}
  }
  const organizerId = String(eventData?.organizer_id || eventData?.organizerId || '')
  const context =
    args.context && args.context.organizerId === organizerId
      ? args.context
      : await loadOrganizerAvailabilityContext(organizerId, now)

  const [ticketsSnap, earningsDoc, canonicalSnap, promoterCommissionMinor, reviewSnap] = await Promise.all([
    adminDb.collection('tickets').where('event_id', '==', eventId).get(),
    findEventEarningsDoc(eventId),
    // lib/events/cancel.ts stamps event_earnings/{eventId}; on events whose
    // ledger row has a random id that stamp lives on a second doc. Read it too.
    adminDb.collection('event_earnings').doc(eventId).get(),
    // No fallbacks: a commission or review lookup that fails must fail the
    // whole figure, never quietly report the promoter's money or a held event
    // as the organizer's to take.
    getFundedCommissionForEvent(eventId),
    adminDb.collection('payout_review_queue').doc(eventId).get(),
  ])

  const earnings = earningsDoc ? ((earningsDoc.data() as any) || {}) : null
  const canonical = canonicalSnap?.exists ? ((canonicalSnap.data() as any) || {}) : null
  const cancelledStamp = (row: any) =>
    Boolean(row && (String(row.settlementStatus || '') === 'cancelled' || row.cancelledAt))
  // The running gross caps the ticket-derived figure only on rows known to
  // cover every sale (grossSalesComplete, stamped at row creation). Older rows
  // — created after an event had already sold, or before the flag existed —
  // would put honest events in review, so they carry no cap until backfilled.
  const ledgerGross =
    earnings != null && earnings.grossSalesComplete === true && earnings.grossSales != null
      ? Number(earnings.grossSales)
      : null
  const currency = normalizeCurrencyCode(eventData?.currency)
  const reviewStatus = reviewSnap?.exists ? String((reviewSnap.data() as any)?.status || '') || null : null

  return computeEventAvailability({
    event: { id: eventId, ...eventData },
    tickets: ticketsSnap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() || {}) })),
    fee: feeRuleForEvent(eventData, context.settings),
    promoterCommissionMinor: Number(promoterCommissionMinor) || 0,
    ledger: earnings
      ? {
          withdrawnMinor: Number(earnings.withdrawnAmount || 0) || 0,
          currencyBlocked: Boolean(storedEarningsCurrencyMismatch(earnings.currency, eventData?.currency)),
          grossMinor: ledgerGross !== null && Number.isFinite(ledgerGross) ? ledgerGross : null,
          cancelled: cancelledStamp(earnings) || cancelledStamp(canonical),
        }
      : cancelledStamp(canonical)
        ? { withdrawnMinor: 0, cancelled: true }
        : null,
    batchPayouts: context.batchPayouts,
    release: {
      history: historyFor(context.releaseContext, eventId, currency),
      config: resolveConfig(context.releaseContext.platformConfig, context.releaseContext.override),
      reviewStatus,
    },
    now,
  })
}

export type OrganizerEventAvailability = EventAvailability & {
  title: string
  eventDate: string | null
  country: string | null
  /** The event doc as read, for callers that must pass it on (e.g. the gate). */
  eventData: any
}

/** Every event this organizer owns, plus per-currency totals. */
export async function loadOrganizerAvailability(
  organizerId: string,
  now: Date = new Date()
): Promise<{ events: OrganizerEventAvailability[]; totals: CurrencyTotals[]; context: OrganizerAvailabilityContext }> {
  const [eventsSnap, context] = await Promise.all([
    adminDb.collection('events').where('organizer_id', '==', organizerId).get(),
    loadOrganizerAvailabilityContext(organizerId, now),
  ])

  const events: OrganizerEventAvailability[] = []
  for (const doc of eventsSnap.docs) {
    const data = doc.data() || {}
    const availability = await loadEventAvailability({ eventId: doc.id, eventData: data, context, now })
    if (!availability) continue
    const start = data.start_datetime ?? data.startDateTime ?? data.date_time ?? data.date
    const startDate = start?.toDate ? start.toDate() : start ? new Date(start) : null
    events.push({
      ...availability,
      title: String(data.title || 'Event'),
      eventDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
      country: data.country ? String(data.country) : null,
      eventData: data,
    })
  }

  return { events, totals: summarizeAvailability(events), context }
}
