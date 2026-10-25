import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'
import { issueCompTickets } from '@/lib/tickets/compIssue'

/**
 * Issue complimentary (free) tickets for an event.
 * The event's org (owner, admin, manager) or a platform admin. Creates
 * `quantity` ticket docs with source='comp', price 0, status 'valid', the chosen
 * tier, and the recipient's name, so comps scan like any other ticket. The
 * issuance itself (capacity, account or guest link, email) is shared with the
 * guest list: lib/tickets/compIssue.ts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    if (!eventId) return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })

    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    const event = eventDoc.data() as any

    if (!(await canOnEvent(user, event, 'manage_events')).allowed) {
      return NextResponse.json({ error: 'You do not own this event' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const result = await issueCompTickets({
      eventId,
      event,
      issuerId: user.id,
      recipientName: String(body?.recipient_name || ''),
      recipientEmail: String(body?.recipient_email || ''),
      note: String(body?.note || ''),
      tierId: String(body?.tier_id || ''),
      quantity: Number(body?.quantity) || 1,
      source: 'comp',
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, ...(result.remaining !== undefined ? { remaining: result.remaining } : {}) },
        { status: result.status }
      )
    }

    return NextResponse.json({
      success: true,
      count: result.ticketIds.length,
      ticketIds: result.ticketIds,
      emailed: result.emailed,
      emailLimited: result.emailLimited,
      ticketLink: result.ticketLink,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to issue comps' }, { status: 500 })
  }
}
