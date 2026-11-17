import { NextRequest, NextResponse } from 'next/server'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { requireFinanceView, orgDisplayName } from '@/lib/organizer/context'
import { adminDb } from '@/lib/firebase/admin'
import { marketTimezone } from '@/lib/notifications/policy'
import { isoDay, parseExportFormat } from '@/lib/exports/fileName'
import { EXPORT_LABELS, EXPORT_LOCALE, exportLang } from '@/lib/exports/labels'
import { exportResponse } from '@/lib/exports/respond'
import type { ExportReport, StatusTone } from '@/lib/exports/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/organizer/export-payouts?format=xlsx|pdf&lang=en|fr|ht
 *
 * The acting org's payout history (never the caller's own account), as Excel
 * or a printable PDF. Read-only finances: the owner, or an admin the owner
 * granted them. Never includes destination details (account / phone numbers).
 */
const L = {
  en: {
    file: 'Payouts', sheet: 'Payouts', period: 'All payouts to date', requested: 'Requested', amount: 'Amount', method: 'Method',
    status: 'Status', scheduled: 'Scheduled', completed: 'Completed', note: 'Note', id: 'Payout ID',
    count: 'Payouts', paid: 'Paid out', bank: 'Bank transfer', mobile: 'MonCash / NatCash',
    st: { completed: 'Completed', processing: 'Processing', pending: 'Pending', failed: 'Failed', cancelled: 'Cancelled' },
  },
  fr: {
    file: 'Versements', sheet: 'Versements', period: 'Tous les versements à ce jour', requested: 'Demandé le', amount: 'Montant', method: 'Moyen',
    status: 'Statut', scheduled: 'Prévu le', completed: 'Effectué le', note: 'Remarque', id: 'N° de versement',
    count: 'Versements', paid: 'Versé', bank: 'Virement bancaire', mobile: 'MonCash / NatCash',
    st: { completed: 'Effectué', processing: 'En cours', pending: 'En attente', failed: 'Échoué', cancelled: 'Annulé' },
  },
  ht: {
    file: 'Peman', sheet: 'Peman', period: 'Tout peman jiska jodi a', requested: 'Mande', amount: 'Montan', method: 'Mwayen',
    status: 'Estati', scheduled: 'Pwograme', completed: 'Fini', note: 'Nòt', id: 'Nimewo peman',
    count: 'Peman', paid: 'Peye deja', bank: 'Transfè labank', mobile: 'MonCash / NatCash',
    st: { completed: 'Fini', processing: 'Ap trete', pending: 'Ap tann', failed: 'Echwe', cancelled: 'Anile' },
  },
} as const

const TONE: Record<string, StatusTone> = {
  completed: 'positive',
  processing: 'warning',
  pending: 'warning',
  failed: 'negative',
  cancelled: 'neutral',
}

export async function GET(request: NextRequest) {
  try {
    // Read-only finances: the owner, or an admin the owner granted them.
    // The acting org's payouts, never the caller's own account.
    const gate = await requireFinanceView()
    if (!gate.ok) return gate.response
    const organizerId = gate.value.orgId

    const { searchParams } = new URL(request.url)
    const format = parseExportFormat(searchParams.get('format') || 'xlsx')
    if (!format) return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
    const lang = exportLang(searchParams.get('lang'))
    const l = L[lang]

    // Get all payouts (no limit for export)
    const [payouts, orgName, orgDoc] = await Promise.all([
      getPayoutHistory(organizerId, 1000),
      orgDisplayName(organizerId),
      adminDb.collection('organizers').doc(organizerId).get().catch(() => null),
    ])
    const org = (orgDoc && orgDoc.exists ? orgDoc.data() : {}) || {}
    const timeZone = marketTimezone(org.country || org.payout_country) || 'America/Port-au-Prince'

    const paidByCurrency = new Map<string, number>()
    for (const p of payouts) {
      if (p.status !== 'completed') continue
      const cur = String(p.currency || 'HTG').toUpperCase()
      paidByCurrency.set(cur, (paidByCurrency.get(cur) || 0) + p.amount)
    }
    const paidLine =
      Array.from(paidByCurrency.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([cur, cents]) => {
          try {
            return `${new Intl.NumberFormat(EXPORT_LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} ${cur}`
          } catch {
            return `${(cents / 100).toFixed(2)} ${cur}`
          }
        })
        .join(' · ') || '0'

    const title = orgName || 'Tikèm'
    const report: ExportReport = {
      title,
      reportLabel: l.file,
      subtitle: [l.period],
      stats: [
        { label: l.count, value: String(payouts.length) },
        { label: l.paid, value: paidLine },
      ],
      sections: [
        {
          name: l.sheet,
          totals: true,
          columns: [
            { key: 'requested', header: l.requested, kind: 'date' },
            { key: 'amount', header: l.amount, kind: 'money', total: true },
            { key: 'method', header: l.method, width: 18 },
            { key: 'status', header: l.status, kind: 'status' },
            { key: 'scheduled', header: l.scheduled, kind: 'date' },
            { key: 'completed', header: l.completed, kind: 'date' },
            { key: 'note', header: l.note, width: 26 },
            { key: 'id', header: l.id, width: 22, pdf: false },
          ],
          rows: payouts.map((p) => ({
            requested: p.createdAt || null,
            amount: { amount: p.amount / 100, currency: String(p.currency || 'HTG').toUpperCase() },
            method: p.method === 'bank_transfer' ? l.bank : l.mobile,
            status: { label: (l.st as Record<string, string>)[p.status] || p.status, tone: TONE[p.status] || 'neutral' },
            scheduled: p.scheduledDate || null,
            completed: p.completedAt || null,
            note: p.failureReason || '',
            id: p.id,
          })),
        },
      ],
      locale: EXPORT_LOCALE[lang],
      timeZone,
      labels: EXPORT_LABELS[lang],
    }

    return await exportResponse(report, format, { title, label: l.file, day: isoDay(new Date(), timeZone) })
  } catch (error: any) {
    console.error('Error exporting payouts:', error)
    return NextResponse.json({ error: 'Failed to export payouts' }, { status: 500 })
  }
}
