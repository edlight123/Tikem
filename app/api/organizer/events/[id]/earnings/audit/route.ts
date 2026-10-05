import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'

type AuditTicketRow = {
  ticketId: string
  status: string
  purchasedAt: string
  tierId: string | null
  tierName: string
  listedUnitPrice: number
  listedUnitPriceCents: number
  listedCurrency: string
  paymentMethod: string | null
  paymentId: string | null
}

type PriceBucketRow = {
  tierId: string | null
  tierName: string
  listedUnitPrice: number
  listedUnitPriceCents: number
  listedCurrency: string
  ticketsSold: number
  grossSalesCents: number
  firstPurchaseAt: string
  lastPurchaseAt: string
}

function normalizeCurrency(raw: unknown): string {
  const value = String(raw || '').trim().toUpperCase()
  return value.length > 0 ? value : 'HTG'
}

function toIso(value: any): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString()
  try {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  } catch {
    return ''
  }
}

function csvEscape(cell: unknown): string {
  const text = String(cell ?? '')
  return `"${text.replace(/\"/g, '""')}"`
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: eventId } = await params

    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const event = eventDoc.data() || {}
    if (String(event.organizer_id || '') !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const format = (url.searchParams.get('format') || 'csv').toLowerCase()
    if (format !== 'csv') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const tickets: AuditTicketRow[] = []
    const buckets = new Map<string, PriceBucketRow>()

    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null

    while (true) {
      let queryRef = adminDb
        .collection('tickets')
        .where('event_id', '==', eventId)
        .orderBy('purchased_at', 'desc')
        .select(
          'status',
          'purchased_at',
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
          'payment_method',
          'payment_id'
        )
        .limit(1000) as FirebaseFirestore.Query

      if (lastDoc) {
        queryRef = (queryRef as any).startAfter(lastDoc)
      }

      const snapshot = await queryRef.get()
      if (snapshot.empty) break

      for (const doc of snapshot.docs) {
        const data: any = doc.data() || {}
        const status = String(data.status || '').toLowerCase()
        if (status && status !== 'valid' && status !== 'confirmed') continue

        const tierId = (data.tier_id || data.tierId || null) as string | null
        const tierName = String(data.tier_name || data.tierName || data.ticket_type || data.ticketType || 'General Admission')
        const listedCurrency = normalizeCurrency(data.original_currency || event.currency || data.currency)

        const listedUnitPrice = Number(data.price_paid ?? data.pricePaid ?? 0) || 0
        const listedUnitPriceCents = Math.max(0, Math.round(listedUnitPrice * 100))

        const purchasedAt = toIso(data.purchased_at)

        const paymentMethod = data.payment_method != null ? String(data.payment_method) : null
        const paymentId = data.payment_id != null ? String(data.payment_id) : null

        tickets.push({
          ticketId: doc.id,
          status: String(data.status || ''),
          purchasedAt,
          tierId,
          tierName,
          listedUnitPrice,
          listedUnitPriceCents,
          listedCurrency,
          paymentMethod,
          paymentId,
        })

        const bucketKey = `${String(tierId || tierName)}::${listedUnitPriceCents}::${listedCurrency}`
        const existing = buckets.get(bucketKey)

        if (existing) {
          existing.ticketsSold += 1
          existing.grossSalesCents += listedUnitPriceCents
          if (purchasedAt && purchasedAt < existing.firstPurchaseAt) existing.firstPurchaseAt = purchasedAt
          if (purchasedAt && purchasedAt > existing.lastPurchaseAt) existing.lastPurchaseAt = purchasedAt
        } else {
          buckets.set(bucketKey, {
            tierId,
            tierName,
            listedUnitPrice,
            listedUnitPriceCents,
            listedCurrency,
            ticketsSold: 1,
            grossSalesCents: listedUnitPriceCents,
            firstPurchaseAt: purchasedAt || '',
            lastPurchaseAt: purchasedAt || '',
          })
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.docs.length < 1000) break
    }

    const priceBuckets = Array.from(buckets.values()).sort((a, b) => {
      const tierCompare = a.tierName.localeCompare(b.tierName)
      if (tierCompare !== 0) return tierCompare
      return a.listedUnitPriceCents - b.listedUnitPriceCents
    })

    const eventTitleSafe = String(event.title || 'event')
      .replace(/[^a-z0-9]/gi, '_')
      .slice(0, 80)

    const rows: string[] = []

    rows.push(
      [
        'Ticket ID',
        'Status',
        'Purchased At',
        'Tier ID',
        'Tier Name',
        'Listed Unit Price',
        'Listed Currency',
        'Payment Method',
        'Payment ID',
      ]
        .map(csvEscape)
        .join(',')
    )

    for (const t of tickets) {
      rows.push(
        [
          t.ticketId,
          t.status,
          t.purchasedAt,
          t.tierId || '',
          t.tierName,
          t.listedUnitPrice.toFixed(2),
          t.listedCurrency,
          t.paymentMethod || '',
          t.paymentId || '',
        ]
          .map(csvEscape)
          .join(',')
      )
    }

    // Add a summary table at the end (still CSV) showing each distinct price level per tier.
    rows.push('')
    rows.push(csvEscape('LISTED PRICE BREAKDOWN (Tier price at purchase time, NO FX / NO SPREAD)'))
    rows.push(
      ['Tier ID', 'Tier Name', 'Listed Unit Price', 'Listed Currency', 'Tickets Sold', 'Gross Sales (listed cents)', 'First Purchase At', 'Last Purchase At']
        .map(csvEscape)
        .join(',')
    )

    for (const b of priceBuckets) {
      rows.push(
        [
          b.tierId || '',
          b.tierName,
          b.listedUnitPrice.toFixed(2),
          b.listedCurrency,
          String(b.ticketsSold),
          String(b.grossSalesCents),
          b.firstPurchaseAt,
          b.lastPurchaseAt,
        ]
          .map(csvEscape)
          .join(',')
      )
    }

    const csvContent = rows.join('\n')

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${eventTitleSafe}_earnings_audit.csv"`,
      },
    })
  } catch (e: any) {
    console.error('Earnings audit export error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
