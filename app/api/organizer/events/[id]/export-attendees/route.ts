import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { parseExportFormat } from '@/lib/exports/fileName'
import { EXPORT_LABELS, exportLang } from '@/lib/exports/labels'
import { eventHeader } from '@/lib/exports/eventHeader'
import { loadEventArt } from '@/lib/exports/eventArt'
import { exportResponse } from '@/lib/exports/respond'
import { ticketStatusCell } from '@/lib/exports/ticketStatus'
import type { ExportReport } from '@/lib/exports/types'
import { paymentMethodLabel } from '@/lib/exports/cells'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/organizer/events/:id/export-attendees?format=xlsx|pdf&lang=en|fr|ht
 *
 * The full attendee list as an Excel workbook: every ticket (refunds and
 * cancellations included, with their state), buyer, email, ticket type,
 * price, purchase and check-in times. Buyers resolve through the shared
 * loader (lib/organizer/eventOrdersLoader): the account profile, else the
 * ticket's own details, so guest checkouts, comps and guest-list tickets
 * export with their names.
 *
 * format=pdf is the printable door sheet, which has its own purpose-built
 * renderer at ../attendees/pdf; we send the caller there.
 */
const L = {
  en: { file: 'Attendees', sheet: 'Attendees', name: 'Name', email: 'Email', ticket: 'Ticket type', status: 'Status', price: 'Price paid', method: 'Payment', purchased: 'Purchased', checkedIn: 'Checked in at', id: 'Ticket ID', tickets: 'Live tickets', in: 'Checked in', other: 'Refunded / cancelled', comp: 'Free' },
  fr: { file: 'Participants', sheet: 'Participants', name: 'Nom', email: 'E-mail', ticket: 'Type de billet', status: 'Statut', price: 'Prix payé', method: 'Paiement', purchased: 'Acheté le', checkedIn: 'Entré à', id: 'N° de billet', tickets: 'Billets valides', in: 'Entrés', other: 'Remboursés / annulés', comp: 'Gratuit' },
  ht: { file: 'Patisipan', sheet: 'Patisipan', name: 'Non', email: 'Imèl', ticket: 'Kalite biyè', status: 'Estati', price: 'Pri peye', method: 'Peman', purchased: 'Achte', checkedIn: 'Antre a', id: 'Nimewo biyè', tickets: 'Biyè valab', in: 'Antre', other: 'Ranbouse / anile', comp: 'Gratis' },
} as const

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params
    const url = new URL(request.url)
    const format = parseExportFormat(url.searchParams.get('format') || 'xlsx')
    if (!format) return NextResponse.json({ error: 'format must be xlsx or pdf' }, { status: 400 })
    const lang = exportLang(url.searchParams.get('lang'))

    // The event's org team (owner, admin, manager) or a platform admin.
    const access = await requireEventAccess(eventId, 'view')
    if (!access.ok) return access.response
    const event = access.value.event as Record<string, any>

    if (format === 'pdf') {
      const to = new URL(`/api/organizer/events/${encodeURIComponent(eventId)}/attendees/pdf`, url)
      to.searchParams.set('lang', lang)
      return NextResponse.redirect(to, 307)
    }

    const l = L[lang]
    const rows = await loadEventTicketRows({ ...event, id: eventId })
    rows.sort((a, b) => a.buyer.name.localeCompare(b.buyer.name, undefined, { sensitivity: 'base' }) || a.purchasedAt.localeCompare(b.purchasedAt))

    const live = rows.filter((r) => isLiveTicketStatus(r.status) || String(r.status).toLowerCase() === 'checked_in')
    const checkedIn = live.filter((r) => r.checkedIn).length
    const head = eventHeader(event, lang)
    const art = await loadEventArt(event)

    const report: ExportReport = {
      title: head.title,
      reportLabel: l.file,
      subtitle: head.subtitle,
      organizerName: head.organizerName,
      tone: art.tone,
      poster: art.poster,
      stats: [
        { label: l.tickets, value: String(live.length) },
        { label: l.in, value: String(checkedIn) },
        { label: l.other, value: String(rows.length - live.length) },
      ],
      sections: [
        {
          name: l.sheet,
          columns: [
            { key: 'name', header: l.name, width: 24 },
            { key: 'email', header: l.email, width: 28 },
            { key: 'ticket', header: l.ticket, width: 18 },
            { key: 'status', header: l.status, kind: 'status', width: 14 },
            { key: 'price', header: l.price, kind: 'money' },
            { key: 'method', header: l.method, width: 12 },
            { key: 'purchased', header: l.purchased, kind: 'datetime' },
            { key: 'checkedIn', header: l.checkedIn, kind: 'datetime' },
            { key: 'id', header: l.id, width: 22, pdf: false },
          ],
          rows: rows.map((r) => ({
            name: r.buyer.name,
            email: r.buyer.email,
            ticket: r.tierName,
            status: ticketStatusCell(r.status, r.checkedIn, lang),
            price: { amount: Number(r.pricePaid) || 0, currency: r.currency },
            method: paymentMethodLabel(r.paymentMethod) || (Number(r.pricePaid) > 0 ? '' : l.comp),
            purchased: r.purchasedAt || null,
            checkedIn: r.checkedInAt || null,
            id: r.id,
          })),
          // No totals row: the list includes refunds, so a sum would overstate sales
          // (the sales audit is the money report).
        },
      ],
      locale: head.locale,
      timeZone: head.timeZone,
      labels: EXPORT_LABELS[lang],
    }

    return await exportResponse(report, format, { title: head.title, label: l.file, day: head.day })
  } catch (error) {
    console.error('[export-attendees] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
