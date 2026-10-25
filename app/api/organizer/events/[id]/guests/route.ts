// Organizer guest list for one event: list it, and add a guest. Used by the
// web page's add drawer and the mobile guest-list screen.
// Guests live in the events/{id}/guests sub-collection, which has no client
// rules, so every read and write goes through the Admin SDK behind the same
// ownership check as promoters.
//
// Adding a guest issues real free tickets through the comps path
// (lib/tickets/compIssue.ts): one, or two with a +1. They hold seats like any
// ticket, the door scanner admits them, and a guest with an email gets them
// by email. A guest without one gets a link the organizer shares.

import { NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { parseGuestInput, serializeGuest } from '@/lib/guest-list'
import { loadGuestTicketStates } from '@/lib/guest-list-server'
import { canOnEvent, type CurrentUser } from '@/lib/organizer/context'
import type { OrgAction } from '@/lib/organizer/teamRoles'
import { compTicketLink, issueCompTickets } from '@/lib/tickets/compIssue'

async function assertEventOwnedByUser(eventId: string, user: CurrentUser, action: OrgAction): Promise<
  { ok: true; event: Record<string, any> } | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  if (!(await canOnEvent(user, eventData, action)).allowed) return { ok: false, status: 403, error: 'Unauthorized' }
  return { ok: true, event: eventData }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ownership = await assertEventOwnedByUser(id, user, 'view')
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    // Same query as the web page, so both surfaces list the same guests.
    const snap = await adminDb
      .collection('events')
      .doc(id)
      .collection('guests')
      .orderBy('invited_at', 'desc')
      .limit(1000)
      .get()

    const docs = snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }))
    const tickets = await loadGuestTicketStates(docs.map((d: any) => d.data))
    const guests = docs.map((d: any) =>
      serializeGuest(d.id, d.data, tickets, compTicketLink({
        guestOrderKey: d.data.guest_order_key || null,
        ticketId: (d.data.ticket_ids || [])[0] || null,
      }))
    )
    return NextResponse.json({ guests })
  } catch (err: any) {
    console.error('[guests] list failed', err)
    return NextResponse.json({ error: 'Failed to load guests' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const ownership = await assertEventOwnedByUser(id, user, 'manage_events')
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseGuestInput(body, false)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const guestsRef = adminDb.collection('events').doc(id).collection('guests')
    const email = parsed.value.email || ''
    if (email) {
      const existing = await guestsRef.where('email', '==', email).limit(1).get()
      if (!existing.empty) {
        return NextResponse.json({ error: 'This guest is already on the list' }, { status: 409 })
      }
    }

    // invited_at is a Timestamp: the web page orders on it and reads .toDate(),
    // so a doc without it would silently drop off that page.
    const now = Timestamp.now()
    const plusOne = parsed.value.plus_one === true
    const guestData: Record<string, any> = {
      name: parsed.value.name,
      email,
      plus_one: plusOne,
      status: 'invited',
      checked_in: false,
      invited_at: now,
      invited_by: user.id,
      updated_at: now,
      ticket_ids: [],
    }
    const ref = await guestsRef.add(guestData)

    // The guest's tickets: the same issuance as comps (capacity, account or
    // guest link, email). If it fails, the guest is not left on the list
    // without a ticket.
    let issued
    try {
      issued = await issueCompTickets({
        eventId: id,
        event: ownership.event,
        issuerId: user.id,
        recipientName: String(parsed.value.name || ''),
        recipientEmail: email,
        note: 'Guest list',
        tierId: typeof body?.tier_id === 'string' ? body.tier_id : '',
        quantity: plusOne ? 2 : 1,
        source: 'guest_list',
        guestListId: ref.id,
      })
    } catch (issueErr) {
      await ref.delete().catch(() => {})
      throw issueErr
    }
    if (!issued.ok) {
      await ref.delete().catch(() => {})
      return NextResponse.json({ error: issued.error, code: issued.code }, { status: issued.status })
    }

    const ticketFields = {
      ticket_ids: issued.ticketIds,
      tier_id: issued.tierId,
      reservation_id: issued.reservationId || null,
      guest_order_key: issued.guestOrderKey,
      recipient_uid: issued.recipientUid,
      email_sent: issued.emailed,
      updated_at: Timestamp.now(),
    }
    await ref.update(ticketFields)
    const saved = { ...guestData, ...ticketFields }

    return NextResponse.json(
      {
        success: true,
        guest: serializeGuest(
          ref.id,
          saved,
          issued.ticketIds.map((tid) => ({ id: tid, status: 'valid', checked_in: false })),
          issued.ticketLink
        ),
        emailed: issued.emailed,
        emailLimited: issued.emailLimited,
        ticketLink: issued.ticketLink,
      },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('[guests] create failed', err)
    return NextResponse.json({ error: 'Failed to add guest' }, { status: 500 })
  }
}
