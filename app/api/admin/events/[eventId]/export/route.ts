import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { adminError } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { calculateEventCurrencyFees } from '@/lib/earnings'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { fixedFeeMinorFor, locationFeesForCountry } from '@/types/platform-settings'
import { defaultCurrencyForCountry } from '@/lib/country-support'
import { ticketFeeIncidence } from '@/lib/payouts/fee-incidence'
import { isoDay, parseExportFormat } from '@/lib/exports/fileName'
import { EXPORT_LABELS } from '@/lib/exports/labels'
import { eventHeader } from '@/lib/exports/eventHeader'
import { loadEventArt } from '@/lib/exports/eventArt'
import { exportResponse } from '@/lib/exports/respond'
import type { ExportReport, ExportSection } from '@/lib/exports/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

type PaymentMethod = 'stripe' | 'stripe_connect' | 'moncash' | 'moncash_button' | 'natcash' | 'sogepay' | 'unknown'

function toIsoTimestamp(value: any): string {
  if (!value) return ''
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate()
      return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : ''
    } catch {
      return ''
    }
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toISOString() : ''
  }
  return ''
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

function centsFromMajor(maybeMajor: unknown): number {
  const value = Number(maybeMajor)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

function majorFromCents(cents: number): number {
  return Math.round(cents) / 100
}

type TicketRow = {
  id: string
  status: string
  purchasedAtIso: string
  attendeeId: string
  attendeeName: string
  attendeeEmail: string
  tierId: string
  tierName: string
  paymentId: string
  paymentMethod: PaymentMethod
  grossEventCents: number
  chargedCurrency: string
  chargedAmountCents: number
  fxRate: number | null
  feeIncidence: 'buyer' | 'organizer'
}

async function loadTicketsForEvent(eventId: string) {
  try {
    const snap = await adminDb.collection('tickets').where('event_id', '==', eventId).get()
    if (!snap.empty) return snap
  } catch {
    // ignore
  }

  try {
    return await adminDb.collection('tickets').where('eventId', '==', eventId).get()
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params

  const { user, error } = await requireAdmin()
  if (error || !user) return adminError('Unauthorized', 401)

  const url = new URL(request.url)
  const mode = (url.searchParams.get('mode') || 'full').toLowerCase()
  if (mode !== 'full' && mode !== 'summary') {
    return adminError('Invalid mode', 400, 'mode must be full or summary')
  }
  const format = parseExportFormat(url.searchParams.get('format') || 'xlsx')
  if (!format) return adminError('Invalid format', 400, 'format must be xlsx or pdf')

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return adminError('Event not found', 404)
  const event = eventDoc.data() || {}

  const ticketsSnap = await loadTicketsForEvent(eventId)
  if (!ticketsSnap) return adminError('Failed to load tickets', 500)

  const tickets: TicketRow[] = []

  for (const doc of ticketsSnap.docs) {
    const data: any = doc.data() || {}
    const status = String(data.status || '').toLowerCase()
    if (status === 'cancelled' || status === 'refunded' || status === 'pending') continue

    const grossEventCents = centsFromMajor(data.price_paid ?? data.pricePaid ?? data.total_paid ?? 0)
    if (!Number.isFinite(grossEventCents) || grossEventCents <= 0) continue

    const purchasedAtIso =
      toIsoTimestamp(data.purchased_at) ||
      toIsoTimestamp(data.purchasedAt) ||
      toIsoTimestamp(data.created_at) ||
      toIsoTimestamp(data.createdAt)

    const paymentMethod = normalizePaymentMethod(data.payment_method ?? data.paymentMethod)
    const fxRateRaw = data.exchange_rate_used ?? data.exchangeRateUsed ?? data.fxRate
    const fxRate = fxRateRaw != null && Number.isFinite(Number(fxRateRaw)) ? Number(fxRateRaw) : null

    const chargedCurrency = String(data.charged_currency || data.chargedCurrency || '').toUpperCase()

    // Prefer explicitly recorded charged_amount (major) if present.
    const chargedAmountCents = (() => {
      const chargedMajor = data.charged_amount ?? data.chargedAmount
      if (chargedMajor != null && Number.isFinite(Number(chargedMajor)) && Number(chargedMajor) > 0) {
        return centsFromMajor(chargedMajor)
      }

      // Best-effort inference for older tickets.
      if ((paymentMethod === 'stripe' || paymentMethod === 'stripe_connect') && fxRate && fxRate > 0) {
        return Math.round((grossEventCents / 100) * fxRate * 100)
      }
      if ((paymentMethod === 'moncash' || paymentMethod === 'moncash_button') && fxRate && fxRate > 0) {
        return Math.round((grossEventCents / 100) * fxRate * 100)
      }
      return grossEventCents
    })()

    const attendeeEmail = String(data.attendee_email || data.attendeeEmail || data.email || '')

    tickets.push({
      id: doc.id,
      status: status || String(data.status || ''),
      purchasedAtIso,
      attendeeId: String(data.attendee_id || data.attendeeId || ''),
      attendeeName: String(data.attendee_name || data.attendeeName || ''),
      attendeeEmail,
      tierId: String(data.tier_id || data.tierId || ''),
      tierName: String(data.tier_name || data.tierName || data.ticket_type || ''),
      paymentId: String(data.payment_id || data.paymentId || 'unknown'),
      paymentMethod,
      grossEventCents,
      chargedCurrency,
      chargedAmountCents,
      fxRate,
      // The payout engine's rule (lib/payouts/fee-incidence.ts): a buyer who
      // paid the fee on top leaves the organizer the full face value.
      feeIncidence: ticketFeeIncidence(data),
    })
  }

  // Group by paymentId to apply fixed fees once per purchase.
  const groups = new Map<
    string,
    {
      paymentId: string
      paymentMethod: PaymentMethod
      fxRate: number | null
      grossEventCents: number
      chargedAmountCents: number
      feeIncidence: 'buyer' | 'organizer'
      tickets: TicketRow[]
    }
  >()

  for (const ticket of tickets) {
    const current = groups.get(ticket.paymentId)
    if (!current) {
      groups.set(ticket.paymentId, {
        paymentId: ticket.paymentId,
        paymentMethod: ticket.paymentMethod,
        fxRate: ticket.fxRate,
        grossEventCents: ticket.grossEventCents,
        chargedAmountCents: ticket.chargedAmountCents,
        feeIncidence: ticket.feeIncidence,
        tickets: [ticket],
      })
      continue
    }

    groups.set(ticket.paymentId, {
      paymentId: current.paymentId,
      paymentMethod: current.paymentMethod !== 'unknown' ? current.paymentMethod : ticket.paymentMethod,
      fxRate: current.fxRate ?? ticket.fxRate,
      grossEventCents: current.grossEventCents + ticket.grossEventCents,
      chargedAmountCents: current.chargedAmountCents + ticket.chargedAmountCents,
      // One payment is one charge; should its tickets disagree, take the
      // fee-bearing reading (same as lib/earnings.ts).
      feeIncidence: current.feeIncidence === 'buyer' && ticket.feeIncidence === 'buyer' ? 'buyer' : 'organizer',
      tickets: [...current.tickets, ticket],
    })
  }

  const eventCurrency = String(event.currency || event.original_currency || 'HTG').toUpperCase() || 'HTG'
  const eventTitle = String(event.title || '')

  // The ledger's per-market fee terms (lib/earnings.ts): HT 10%, US/CA 6% +
  // 0.99, FR 2.5% + €0.50 per paid ticket, as currently configured.
  const eventCountry = String(event.country || 'HT')
  const marketFees = locationFeesForCountry(await getPlatformSettings(), eventCountry)
  const fixedFeeMinorPerTicket = fixedFeeMinorFor(
    marketFees,
    event.currency || defaultCurrencyForCountry(eventCountry)
  )
  // processingFee here is the card/MonCash processing Tikèm absorbs: reported
  // for the books, never deducted from the organizer's net.
  const feesForGroup = (group: { grossEventCents: number; paymentMethod: PaymentMethod; chargedAmountCents: number; fxRate: number | null; feeIncidence: 'buyer' | 'organizer'; tickets: TicketRow[] }) => {
    const fees = calculateEventCurrencyFees({
      grossEventCents: group.grossEventCents,
      paymentMethod: group.paymentMethod,
      chargedAmountCents: group.chargedAmountCents,
      fxRate: group.fxRate,
      platformFeePercentage: marketFees.platformFeePercentage,
      fixedFeeMinorPerTicket,
      quantity: group.tickets.length,
      feeIncidence: group.feeIncidence,
    })
    return { platformFee: fees.platformFee, processingFee: fees.absorbedProcessingFee, netAmount: fees.netAmount }
  }

  if (mode === 'summary') {
    let grossEventTotal = 0
    let platformFeeTotal = 0
    let processingFeeTotal = 0
    let netTotal = 0

    const chargedTotalsByCurrency = new Map<string, number>()

    for (const group of Array.from(groups.values())) {
      const fees = feesForGroup(group)
      grossEventTotal += group.grossEventCents
      platformFeeTotal += fees.platformFee
      processingFeeTotal += fees.processingFee
      netTotal += fees.netAmount

      // Charged totals by charged currency (ticket-level field can vary; use tickets to aggregate).
      for (const t of group.tickets) {
        const cur = t.chargedCurrency || ''
        if (!cur) continue
        chargedTotalsByCurrency.set(cur, (chargedTotalsByCurrency.get(cur) || 0) + t.chargedAmountCents)
      }
    }

    const chargedTotalsString = Array.from(chargedTotalsByCurrency.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cur, cents]) => `${cur} ${majorFromCents(cents).toFixed(2)}`)
      .join(' | ')

    await logAdminAction({
      action: 'event.export_financials',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: eventId,
      resourceType: 'event',
      details: { mode: 'summary', format, ticketsCount: tickets.length, paymentCount: groups.size },
    })

    const m = (cents: number) => ({ amount: majorFromCents(cents), currency: eventCurrency })
    const summarySection: ExportSection = {
      name: 'Summary',
      columns: [
        { key: 'item', header: 'Item', width: 30 },
        { key: 'value', header: 'Amount', kind: 'money', width: 18 },
        { key: 'detail', header: 'Detail', width: 40 },
      ],
      rows: [
        { item: 'Gross (event currency)', value: m(grossEventTotal), detail: '' },
        { item: 'Platform fee', value: m(platformFeeTotal), detail: `${eventCountry} market terms` },
        { item: 'Processing fee (absorbed by Tikèm)', value: m(processingFeeTotal), detail: 'Reported for the books, not deducted' },
        { item: 'Organizer net', value: m(netTotal), detail: '' },
        { item: 'Charged totals', value: null, detail: chargedTotalsString },
      ],
    }

    return exportResponse(
      await adminReport(event, eventId, 'Financial summary', [summarySection], [
        { label: 'Tickets', value: String(tickets.length) },
        { label: 'Payments', value: String(groups.size) },
        { label: 'Organizer net', value: `${majorFromCents(netTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${eventCurrency}` },
      ]),
      format,
      { title: eventTitle || eventId, label: 'Financial summary', day: isoDay(new Date()) }
    )
  }

  // Full export: allocate per-payment fees down to ticket rows proportionally.
  const allocationsByTicketId = new Map<string, { platformFee: number; processingFee: number; organizerNet: number }>()

  for (const group of Array.from(groups.values())) {
    const fees = feesForGroup(group)

    const groupTickets = group.tickets
    if (groupTickets.length === 0 || group.grossEventCents <= 0) continue

    // Deterministic allocation: allocate rounded shares, last ticket gets remainder.
    const sorted = [...groupTickets].sort((a, b) => a.id.localeCompare(b.id))

    let remainingPlatform = fees.platformFee
    let remainingProcessing = fees.processingFee
    let remainingNet = fees.netAmount

    for (let i = 0; i < sorted.length; i++) {
      const ticket = sorted[i]
      const isLast = i === sorted.length - 1
      if (isLast) {
        allocationsByTicketId.set(ticket.id, {
          platformFee: remainingPlatform,
          processingFee: remainingProcessing,
          organizerNet: remainingNet,
        })
        break
      }

      const share = ticket.grossEventCents / group.grossEventCents
      const platformFee = Math.round(fees.platformFee * share)
      const processingFee = Math.round(fees.processingFee * share)
      const organizerNet = Math.round(fees.netAmount * share)

      remainingPlatform -= platformFee
      remainingProcessing -= processingFee
      remainingNet -= organizerNet

      allocationsByTicketId.set(ticket.id, { platformFee, processingFee, organizerNet })
    }
  }

  const fullSection: ExportSection = {
    name: 'Tickets',
    totals: true,
    columns: [
      { key: 'purchasedAt', header: 'Purchased', kind: 'datetime' },
      { key: 'attendeeName', header: 'Attendee', width: 22 },
      { key: 'attendeeEmail', header: 'Email', width: 26, pdf: false },
      { key: 'tierName', header: 'Ticket type', width: 16 },
      { key: 'status', header: 'Status', width: 10, pdf: false },
      { key: 'paymentMethod', header: 'Method', width: 12 },
      { key: 'grossEventAmount', header: `Gross (${eventCurrency})`, kind: 'money', currency: eventCurrency, total: true },
      { key: 'chargedAmount', header: 'Charged', kind: 'money' },
      { key: 'fxRate', header: 'FX rate', kind: 'number', width: 9 },
      { key: 'platformFeeAmount', header: 'Platform fee', kind: 'money', currency: eventCurrency, total: true },
      { key: 'processingFeeAmount', header: 'Processing (absorbed)', kind: 'money', currency: eventCurrency, total: true },
      { key: 'organizerNetAmount', header: 'Organizer net', kind: 'money', currency: eventCurrency, total: true },
      { key: 'ticketId', header: 'Ticket ID', width: 22, pdf: false },
      { key: 'attendeeId', header: 'Attendee ID', width: 22, pdf: false },
      { key: 'tierId', header: 'Tier ID', width: 16, pdf: false },
      { key: 'paymentId', header: 'Payment ID', width: 24, pdf: false },
    ],
    rows: tickets
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => {
        const alloc = allocationsByTicketId.get(t.id) || { platformFee: 0, processingFee: 0, organizerNet: 0 }
        return {
          ticketId: t.id,
          status: t.status,
          purchasedAt: t.purchasedAtIso || null,
          attendeeId: t.attendeeId,
          attendeeName: t.attendeeName,
          attendeeEmail: t.attendeeEmail,
          tierId: t.tierId,
          tierName: t.tierName,
          paymentId: t.paymentId,
          paymentMethod: t.paymentMethod,
          grossEventAmount: majorFromCents(t.grossEventCents),
          chargedAmount: { amount: majorFromCents(t.chargedAmountCents), currency: t.chargedCurrency || eventCurrency },
          fxRate: t.fxRate ?? null,
          platformFeeAmount: majorFromCents(alloc.platformFee),
          processingFeeAmount: majorFromCents(alloc.processingFee),
          organizerNetAmount: majorFromCents(alloc.organizerNet),
        }
      }),
  }

  await logAdminAction({
    action: 'event.export_financials',
    adminId: user.id,
    adminEmail: user.email || '',
    resourceId: eventId,
    resourceType: 'event',
    details: { mode: 'full', format, ticketsCount: tickets.length, paymentCount: groups.size },
  })

  return exportResponse(
    await adminReport(event, eventId, 'Financials', [fullSection], [
      { label: 'Tickets', value: String(tickets.length) },
      { label: 'Payments', value: String(groups.size) },
    ]),
    format,
    { title: eventTitle || eventId, label: 'Financials', day: isoDay(new Date()) }
  )
}

/** The admin export's header: the event's own header, English, staff-facing. */
async function adminReport(
  event: Record<string, any>,
  eventId: string,
  reportLabel: string,
  sections: ExportSection[],
  stats: ExportReport['stats']
): Promise<ExportReport> {
  const head = eventHeader(event, 'en')
  const art = await loadEventArt(event)
  return {
    title: head.title || eventId,
    reportLabel,
    subtitle: [...head.subtitle, `Event ${eventId}`],
    organizerName: head.organizerName,
    tone: art.tone,
    poster: art.poster,
    stats,
    sections,
    locale: 'en-US',
    timeZone: head.timeZone,
    labels: EXPORT_LABELS.en,
  }
}
