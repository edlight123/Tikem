import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { resendTicketToHolder } from '@/lib/tickets/resend'
import { loadOwnedTickets, parseTicketIds } from '@/lib/organizer/ticketActions'

export const dynamic = 'force-dynamic'

const MAX_TICKETS = 20
// One resend per ticket per minute: enough to fix "I never got it", not enough
// to turn the button into a way to flood a buyer's inbox.
const COOLDOWN_MS = 60_000

/**
 * Organizer action: re-send the ticket email (and SMS/WhatsApp, as originally
 * delivered) to each ticket's holder. Called by the web attendee drawer with
 * `{ ticketId }` and by the mobile order view with `{ ticketIds }`.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const ids = parseTicketIds(body, MAX_TICKETS)
    if (!ids) return NextResponse.json({ error: 'ticketId or ticketIds is required' }, { status: 400 })

    const loaded = await loadOwnedTickets(ids)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const { event } = loaded.access

    const now = Date.now()
    let sent = 0
    const skipped: { ticketId: string; reason: string }[] = []

    for (const ticket of loaded.tickets) {
      const status = String(ticket.status || '').toLowerCase()
      if (!isLiveTicketStatus(status) && status !== 'checked_in') {
        skipped.push({ ticketId: ticket.id, reason: 'not_live' })
        continue
      }
      const last = Date.parse(String(ticket.last_resent_at || ''))
      if (Number.isFinite(last) && now - last < COOLDOWN_MS) {
        skipped.push({ ticketId: ticket.id, reason: 'too_soon' })
        continue
      }

      const result = await resendTicketToHolder(ticket, event, '[organizer-resend]')
      if (!result.ok) {
        skipped.push({ ticketId: ticket.id, reason: result.reason })
        continue
      }
      sent += 1
      await adminDb
        .collection('tickets')
        .doc(ticket.id)
        .set({ last_resent_at: new Date(now).toISOString() }, { merge: true })
        .catch(() => undefined)
    }

    if (sent === 0) {
      const reason = skipped[0]?.reason || 'send_failed'
      const status = reason === 'too_soon' ? 429 : reason === 'no_email' ? 422 : reason === 'not_live' ? 409 : 502
      return NextResponse.json({ error: 'Nothing was sent', code: reason, skipped }, { status })
    }
    return NextResponse.json({ success: true, sent, skipped })
  } catch (error) {
    console.error('[resend-ticket] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
