import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent } from '@/lib/organizer/context'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { loadEventArt } from '@/lib/exports/eventArt'
import { exportFileName, isoDay } from '@/lib/exports/fileName'
import { fileResponse } from '@/lib/exports/respond'
import { marketTimezone } from '@/lib/notifications/policy'
import { renderAttendeeListPdf, type PdfAttendee } from '@/lib/attendees/attendeeListPdf'
import { toDate } from '@/lib/postEvent/timing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/organizer/events/:id/attendees/pdf?lang=en|fr|ht
 *
 * The branded, printable attendee list (lib/attendees/attendeeListPdf). Same
 * gate as viewing the attendee list: the event's organizer side.
 */

const L = {
  en: {
    tickets: 'Tickets', checkedIn: 'Checked in', name: 'Name', ticket: 'Ticket', in: 'In',
    notValid: 'not valid', generated: 'Generated', file: 'Attendees', page: (n: number, t: number) => `Page ${n} of ${t}`, locale: 'en-US',
  },
  fr: {
    tickets: 'Billets', checkedIn: 'Entrés', name: 'Nom', ticket: 'Billet', in: 'Entrée',
    notValid: 'non valide', generated: 'Généré le', file: 'Participants', page: (n: number, t: number) => `Page ${n} sur ${t}`, locale: 'fr-FR',
  },
  ht: {
    tickets: 'Biyè', checkedIn: 'Antre', name: 'Non', ticket: 'Biyè', in: 'Antre',
    notValid: 'pa valab', generated: 'Fèt', file: 'Patisipan', page: (n: number, t: number) => `Paj ${n} sou ${t}`, locale: 'fr-HT',
  },
} as const

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const eventId = String((await params)?.id || '')
    const snap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
    if (!snap?.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    const event = snap.data() as Record<string, any>
    if (!(await canOnEvent(user, event, 'view')).allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const langParam = new URL(req.url).searchParams.get('lang')
    const lang = (langParam === 'fr' || langParam === 'ht' ? langParam : 'en') as keyof typeof L
    const l = L[lang]
    const tz = (typeof event.timezone === 'string' && event.timezone) || marketTimezone(event.country) || 'America/New_York'

    const tickets = await adminDb.collection('tickets').where('event_id', '==', eventId).get()
    const attendees: PdfAttendee[] = []
    for (const d of tickets.docs as any[]) {
      const t = d.data() || {}
      const status = String(t.status || '').toLowerCase()
      const live = isLiveTicketStatus(t.status) || status === 'checked_in'
      // Refunded / cancelled tickets stay off the door sheet.
      if (!live) continue
      const inAt = t.checked_in === true || t.checked_in_at ? toDate(t.checked_in_at) || new Date() : null
      attendees.push({
        name: String(t.attendee_name || t.guest_name || '').trim(),
        tier: String(t.tier_name || t.ticket_type || '').trim(),
        checkedInAt: inAt,
        live,
      })
    }

    // Poster (thumbnail) + the event's colour from it. Best effort.
    const { poster, tone } = await loadEventArt(event)

    const start = toDate(event.start_datetime)
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => {
      try {
        return new Intl.DateTimeFormat(l.locale, { timeZone: tz, ...o }).format(d)
      } catch {
        return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o }).format(d)
      }
    }
    const dateLine = start
      ? fmt(start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : ''
    const venueLine = [event.venue_name, event.city].filter(Boolean).join(', ')

    const pdf = renderAttendeeListPdf({
      title: String(event.title || ''),
      dateLine,
      venueLine,
      organizerName: String(event.organizer_name || ''),
      tone,
      poster,
      attendees,
      generatedLine: `${l.generated} ${fmt(new Date(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`,
      labels: {
        tickets: l.tickets,
        checkedIn: l.checkedIn,
        name: l.name,
        ticket: l.ticket,
        in: l.in,
        notValid: l.notValid,
        page: l.page,
      },
      timeOf: (d) => fmt(d, { hour: 'numeric', minute: '2-digit' }),
    })

    // "Konpa Night 2026 – Attendees – 2026-12-31.pdf" (lib/exports/fileName).
    const fileName = exportFileName({ title: String(event.title || ''), label: l.file, day: start ? isoDay(start, tz) : '', ext: 'pdf' })
    return fileResponse(pdf, 'pdf', fileName)
  } catch (error) {
    console.error('[attendees/pdf] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
