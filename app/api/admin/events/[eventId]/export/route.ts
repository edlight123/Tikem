import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { adminError } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { calculateFees } from '@/lib/fees'
import { csvRow } from '@/lib/csv'

export const dynamic = 'force-dynamic'

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

function majorFromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2)
}

function calculateEventCurrencyFees(options: {
  grossEventCents: number
  paymentMethod: PaymentMethod
  chargedAmountCents?: number | null
  fxRate?: number | null
}): { platformFee: number; processingFee: number; netAmount: number } {
  const grossEventCents = Math.max(0, Math.round(options.grossEventCents || 0))
  if (grossEventCents <= 0) return { platformFee: 0, processingFee: 0, netAmount: 0 }

  // Platform fee is always calculated on organizer-facing gross (event currency).
  const platformFee = calculateFees(grossEventCents).platformFee

  // Processing fee depends on rail.
  let processingFeeEventCents = 0
  if (options.paymentMethod === 'stripe' || options.paymentMethod === 'stripe_connect') {
    const charged = Math.max(0, Math.round(options.chargedAmountCents ?? grossEventCents))
    const stripeProcessingFeeChargedCents = calculateFees(charged).processingFee
    const fx = typeof options.fxRate === 'number' && Number.isFinite(options.fxRate) && options.fxRate > 0 ? options.fxRate : null
    processingFeeEventCents = fx ? Math.round(stripeProcessingFeeChargedCents / fx) : stripeProcessingFeeChargedCents
  }

  // Processing is reported for the books but is Tikèm's cost, not the organizer's.
  const netAmount = grossEventCents - platformFee
  return { platformFee, processingFee: processingFeeEventCents, netAmount }
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
      tickets: [...current.tickets, ticket],
    })
  }

  const eventCurrency = String(event.currency || event.original_currency || 'HTG').toUpperCase() || 'HTG'
  const eventTitle = String(event.title || '')

  if (mode === 'summary') {
    let grossEventTotal = 0
    let platformFeeTotal = 0
    let processingFeeTotal = 0
    let netTotal = 0

    const chargedTotalsByCurrency = new Map<string, number>()

    for (const group of Array.from(groups.values())) {
      const fees = calculateEventCurrencyFees({
        grossEventCents: group.grossEventCents,
        paymentMethod: group.paymentMethod,
        chargedAmountCents: group.chargedAmountCents,
        fxRate: group.fxRate,
      })
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
      .map(([cur, cents]) => `${cur} ${majorFromCents(cents)}`)
      .join(' | ')

    const headers = [
      'eventId',
      'eventTitle',
      'eventCurrency',
      'ticketsCount',
      'paymentCount',
      'grossEventAmount',
      'platformFeeAmount',
      'processingFeeAmount',
      'organizerNetAmount',
      'chargedTotals',
    ]

    const row = [
      eventId,
      eventTitle,
      eventCurrency,
      tickets.length,
      groups.size,
      majorFromCents(grossEventTotal),
      majorFromCents(platformFeeTotal),
      majorFromCents(processingFeeTotal),
      majorFromCents(netTotal),
      chargedTotalsString,
    ]

    await logAdminAction({
      action: 'event.export_financials',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: eventId,
      resourceType: 'event',
      details: { mode: 'summary', ticketsCount: tickets.length, paymentCount: groups.size },
    })

    const csv = [csvRow(headers), csvRow(row)].join('\n')
    const filename = `event_${eventId}_summary_${new Date().toISOString().split('T')[0]}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // Full export: allocate per-payment fees down to ticket rows proportionally.
  const allocationsByTicketId = new Map<string, { platformFee: number; processingFee: number; organizerNet: number }>()

  for (const group of Array.from(groups.values())) {
    const fees = calculateEventCurrencyFees({
      grossEventCents: group.grossEventCents,
      paymentMethod: group.paymentMethod,
      chargedAmountCents: group.chargedAmountCents,
      fxRate: group.fxRate,
    })

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

  const headers = [
    'ticketId',
    'status',
    'purchasedAt',
    'attendeeId',
    'attendeeName',
    'attendeeEmail',
    'tierId',
    'tierName',
    'paymentId',
    'paymentMethod',
    'eventCurrency',
    'grossEventAmount',
    'chargedCurrency',
    'chargedAmount',
    'fxRate',
    'platformFeeAmount',
    'processingFeeAmount',
    'organizerNetAmount',
  ]

  const rows = tickets
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const alloc = allocationsByTicketId.get(t.id) || { platformFee: 0, processingFee: 0, organizerNet: 0 }
      return [
        t.id,
        t.status,
        t.purchasedAtIso,
        t.attendeeId,
        t.attendeeName,
        t.attendeeEmail,
        t.tierId,
        t.tierName,
        t.paymentId,
        t.paymentMethod,
        eventCurrency,
        majorFromCents(t.grossEventCents),
        t.chargedCurrency,
        majorFromCents(t.chargedAmountCents),
        t.fxRate ?? '',
        majorFromCents(alloc.platformFee),
        majorFromCents(alloc.processingFee),
        majorFromCents(alloc.organizerNet),
      ]
    })

  await logAdminAction({
    action: 'event.export_financials',
    adminId: user.id,
    adminEmail: user.email || '',
    resourceId: eventId,
    resourceType: 'event',
    details: { mode: 'full', ticketsCount: tickets.length, paymentCount: groups.size },
  })

  const csv = [csvRow(headers), ...rows.map(csvRow)].join('\n')
  const filename = `event_${eventId}_financials_${new Date().toISOString().split('T')[0]}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
