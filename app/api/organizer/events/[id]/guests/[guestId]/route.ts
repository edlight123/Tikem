// Edit or remove one guest on an event's guest list (events/{id}/guests/{guestId}).
// Editable: name, email, plus_one (only before tickets exist), and checked_in
// (the organizer marking a guest as arrived by hand, which also checks in the
// guest's tickets so the door and the counts agree).
// Removing a guest cancels their unscanned tickets and gives the seats back.

import { NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { parseGuestInput, serializeGuest } from '@/lib/guest-list'
import { canOnEvent, type CurrentUser } from '@/lib/organizer/context'
import { loadGuestTicketStates } from '@/lib/guest-list-server'
import { compTicketLink } from '@/lib/tickets/compIssue'
import { releaseInventoryReservation } from '@/lib/tickets/inventory'
import { isLiveTicketStatus } from '@/lib/tickets/status'

function ticketRefsOf(guest: any): FirebaseFirestore.DocumentReference[] {
  const ids: string[] = Array.isArray(guest?.ticket_ids) ? guest.ticket_ids.map(String).filter(Boolean) : []
  return ids.map((tid) => adminDb.collection('tickets').doc(tid))
}

async function loadOwnedGuest(eventId: string, guestId: string, user: CurrentUser): Promise<
  | { ok: true; ref: FirebaseFirestore.DocumentReference; data: any }
  | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  if (!(await canOnEvent(user, eventData, 'manage_events')).allowed) return { ok: false, status: 403, error: 'Unauthorized' }

  const ref = adminDb.collection('events').doc(eventId).collection('guests').doc(guestId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, status: 404, error: 'Guest not found' }
  return { ok: true, ref, data: snap.data() }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; guestId: string }> }
) {
  try {
    const { id, guestId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedGuest(id, guestId, user)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    const body = await request.json().catch(() => ({}))
    const parsed = parseGuestInput(body, true)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const updates: Record<string, any> = { ...parsed.value, updated_at: Timestamp.now() }
    const hasTickets = Array.isArray(loaded.data?.ticket_ids) && loaded.data.ticket_ids.length > 0

    // The +1 is a second ticket, issued when the guest was added. Changing it
    // afterwards would leave the tickets and the list disagreeing.
    if (hasTickets && parsed.value.plus_one !== undefined && parsed.value.plus_one !== (loaded.data?.plus_one === true)) {
      return NextResponse.json(
        { error: 'Their tickets are already issued. Remove the guest and add them again to change the +1.', code: 'plus_one_locked' },
        { status: 409 }
      )
    }

    if (parsed.value.email && parsed.value.email !== loaded.data?.email) {
      const dupe = await adminDb
        .collection('events')
        .doc(id)
        .collection('guests')
        .where('email', '==', parsed.value.email)
        .limit(1)
        .get()
      if (!dupe.empty && dupe.docs[0].id !== guestId) {
        return NextResponse.json({ error: 'This guest is already on the list' }, { status: 409 })
      }
    }

    await loaded.ref.update(updates)

    // Ticked in by hand: check the guest's live tickets in too (and out again,
    // but only the ones this list ticked, never a real door scan).
    if (hasTickets && parsed.value.checked_in !== undefined) {
      const snaps = (await adminDb.getAll(...ticketRefsOf(loaded.data))) as any[]
      await Promise.all(
        snaps.map(async (snap) => {
          if (!snap.exists) return
          const t = snap.data() || {}
          if (!isLiveTicketStatus(t.status) && String(t.status || '').toLowerCase() !== 'checked_in') return
          const isIn = t.checked_in === true || Boolean(t.checked_in_at)
          if (parsed.value.checked_in && !isIn) {
            await snap.ref.update({
              checked_in: true,
              checked_in_at: FieldValue.serverTimestamp(),
              checked_in_by: user.id,
              check_in_method: 'manual',
              checked_in_via: 'guest_list',
              entry_point: 'Guest list',
              updated_at: FieldValue.serverTimestamp(),
            })
          } else if (!parsed.value.checked_in && isIn && t.checked_in_via === 'guest_list') {
            await snap.ref.update({
              checked_in: false,
              checked_in_at: null,
              checked_in_by: null,
              checked_in_via: null,
              updated_at: FieldValue.serverTimestamp(),
            })
          }
        })
      )
    }

    const merged = { ...loaded.data, ...updates }
    const tickets = hasTickets ? await loadGuestTicketStates([merged]) : []
    return NextResponse.json({
      success: true,
      guest: serializeGuest(
        guestId,
        merged,
        tickets,
        compTicketLink({ guestOrderKey: merged.guest_order_key || null, ticketId: (merged.ticket_ids || [])[0] || null })
      ),
    })
  } catch (err: any) {
    console.error('[guests] update failed', err)
    return NextResponse.json({ error: 'Failed to update guest' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; guestId: string }> }
) {
  try {
    const { id, guestId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedGuest(id, guestId, user)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    // Cancel the guest's tickets that were never scanned and give the seats
    // back. A ticket already used at the door is left as it is.
    const refs = ticketRefsOf(loaded.data)
    if (refs.length > 0) {
      const snaps = (await adminDb.getAll(...refs)) as any[]
      let cancelled = 0
      for (const snap of snaps) {
        if (!snap.exists) continue
        const t = snap.data() || {}
        if (!isLiveTicketStatus(t.status)) continue
        if (t.checked_in === true || t.checked_in_at) continue
        await snap.ref.update({
          status: 'cancelled',
          cancelled_at: FieldValue.serverTimestamp(),
          cancelled_reason: 'guest_removed',
          cancelled_by: user.id,
          updated_at: FieldValue.serverTimestamp(),
        })
        cancelled += 1
      }
      const tierId = String(loaded.data?.tier_id || '')
      if (cancelled > 0 && loaded.data?.reservation_id) {
        await releaseInventoryReservation({
          reservationId: String(loaded.data.reservation_id),
          eventId: id,
          quantity: cancelled,
          tierIncrements: tierId ? [{ tierId, quantity: cancelled }] : [],
          logPrefix: '[guest_list]',
        })
      }
    }

    await loaded.ref.delete()
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[guests] delete failed', err)
    return NextResponse.json({ error: 'Failed to remove guest' }, { status: 500 })
  }
}
