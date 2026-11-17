import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { canViewEventFinances } from '@/lib/organizer/financeAccess'
import { parseExportFormat } from '@/lib/exports/fileName'
import { EXPORT_LABELS, exportLang } from '@/lib/exports/labels'
import { eventHeader } from '@/lib/exports/eventHeader'
import { loadEventArt } from '@/lib/exports/eventArt'
import { exportResponse } from '@/lib/exports/respond'
import type { ExportReport } from '@/lib/exports/types'
import { paymentMethodLabel } from '@/lib/exports/cells'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/organizer/events/:id/earnings/audit?format=xlsx|pdf&lang=en|fr|ht
 *
 * The sales audit: every counted ticket at its listed price, then the price
 * levels per tier. Excel (typed, sortable, totals) or a printable PDF.
 */
const L = {
  en: {
    file: 'Sales audit', tickets: 'Tickets', breakdown: 'Price breakdown',
    note: 'Tier price at purchase time. No FX, no spread.',
    id: 'Ticket ID', status: 'Status', purchased: 'Purchased', tierId: 'Tier ID', tier: 'Ticket type',
    price: 'Listed price', method: 'Payment method', paymentId: 'Payment ID',
    sold: 'Tickets sold', gross: 'Gross (listed)', first: 'First sale', last: 'Last sale',
    statSold: 'Tickets sold', statGross: 'Gross sales', statLevels: 'Price levels', valid: 'Valid',
  },
  fr: {
    file: 'Audit des ventes', tickets: 'Billets', breakdown: 'Détail des prix',
    note: 'Prix du billet au moment de l’achat. Sans change ni marge.',
    id: 'N° de billet', status: 'Statut', purchased: 'Acheté le', tierId: 'ID du tarif', tier: 'Type de billet',
    price: 'Prix affiché', method: 'Moyen de paiement', paymentId: 'ID du paiement',
    sold: 'Billets vendus', gross: 'Brut (affiché)', first: 'Première vente', last: 'Dernière vente',
    statSold: 'Billets vendus', statGross: 'Ventes brutes', statLevels: 'Niveaux de prix', valid: 'Valide',
  },
  ht: {
    file: 'Odit lavant', tickets: 'Biyè', breakdown: 'Detay pri yo',
    note: 'Pri biyè a lè yo te achte l. San chanj, san maj.',
    id: 'Nimewo biyè', status: 'Estati', purchased: 'Achte', tierId: 'ID tarif', tier: 'Kalite biyè',
    price: 'Pri afiche', method: 'Mwayen peman', paymentId: 'ID peman',
    sold: 'Biyè vann', gross: 'Brit (afiche)', first: 'Premye vant', last: 'Dènye vant',
    statSold: 'Biyè vann', statGross: 'Lavant brit', statLevels: 'Nivo pri', valid: 'Valab',
  },
} as const

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
    // Sales audit = finances: owner, finance-granted admin, platform admin.
    if (!(await canViewEventFinances(user, event))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const format = parseExportFormat(url.searchParams.get('format') || 'xlsx')
    if (!format) {
      return NextResponse.json({ error: 'format must be xlsx or pdf' }, { status: 400 })
    }
    const lang = exportLang(url.searchParams.get('lang'))
    const l = L[lang]

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

    const head = eventHeader(event, lang)
    const art = await loadEventArt(event)
    const money = (amount: number, currency: string) => ({ amount, currency })

    // Gross per currency for the headline ("312,500.00 HTG · 1,200.00 USD").
    const grossByCurrency = new Map<string, number>()
    for (const b of priceBuckets) grossByCurrency.set(b.listedCurrency, (grossByCurrency.get(b.listedCurrency) || 0) + b.grossSalesCents)
    const fmtMoney = (cents: number, cur: string) => {
      try {
        return `${new Intl.NumberFormat(head.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} ${cur}`
      } catch {
        return `${(cents / 100).toFixed(2)} ${cur}`
      }
    }
    const grossLine =
      Array.from(grossByCurrency.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([cur, cents]) => fmtMoney(cents, cur))
        .join(' · ') || '0'

    const report: ExportReport = {
      title: head.title,
      reportLabel: l.file,
      subtitle: head.subtitle,
      organizerName: head.organizerName,
      tone: art.tone,
      poster: art.poster,
      stats: [
        { label: l.statSold, value: String(tickets.length) },
        { label: l.statGross, value: grossLine },
        { label: l.statLevels, value: String(priceBuckets.length) },
      ],
      sections: [
        {
          name: l.tickets,
          totals: true,
          columns: [
            { key: 'purchasedAt', header: l.purchased, kind: 'datetime' },
            { key: 'tierName', header: l.tier, width: 20 },
            { key: 'status', header: l.status, kind: 'status', width: 11 },
            { key: 'price', header: l.price, kind: 'money', total: true },
            { key: 'paymentMethod', header: l.method, width: 14 },
            { key: 'ticketId', header: l.id, width: 22 },
            { key: 'tierId', header: l.tierId, width: 16, pdf: false },
            { key: 'paymentId', header: l.paymentId, width: 24, pdf: false },
          ],
          rows: tickets.map((t) => ({
            ticketId: t.ticketId,
            // Only valid/confirmed tickets reach this list.
            status: { label: l.valid, tone: 'positive' as const },
            purchasedAt: t.purchasedAt || null,
            tierId: t.tierId || '',
            tierName: t.tierName,
            price: money(t.listedUnitPrice, t.listedCurrency),
            paymentMethod: paymentMethodLabel(t.paymentMethod),
            paymentId: t.paymentId || '',
          })),
        },
        {
          name: l.breakdown,
          note: l.note,
          totals: true,
          columns: [
            { key: 'tierName', header: l.tier, width: 22 },
            { key: 'price', header: l.price, kind: 'money' },
            { key: 'sold', header: l.sold, kind: 'integer', total: true },
            { key: 'gross', header: l.gross, kind: 'money', total: true },
            { key: 'first', header: l.first, kind: 'datetime' },
            { key: 'last', header: l.last, kind: 'datetime' },
            { key: 'tierId', header: l.tierId, width: 16, pdf: false },
          ],
          rows: priceBuckets.map((b) => ({
            tierId: b.tierId || '',
            tierName: b.tierName,
            price: money(b.listedUnitPrice, b.listedCurrency),
            sold: b.ticketsSold,
            gross: money(b.grossSalesCents / 100, b.listedCurrency),
            first: b.firstPurchaseAt || null,
            last: b.lastPurchaseAt || null,
          })),
        },
      ],
      locale: head.locale,
      timeZone: head.timeZone,
      labels: EXPORT_LABELS[lang],
    }

    return await exportResponse(report, format, { title: head.title, label: l.file, day: head.day })
  } catch (e: any) {
    console.error('Earnings audit export error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
