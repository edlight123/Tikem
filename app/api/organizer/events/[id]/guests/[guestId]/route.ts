// Edit or remove one guest on an event's guest list (events/{id}/guests/{guestId}).
// Editable: name, email, plus_one, and checked_in (the organizer marking a guest
// as arrived by hand; guest-list entries carry no QR for the scanner to read).

import { NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { parseGuestInput, serializeGuest } from '@/lib/guest-list'

async function loadOwnedGuest(eventId: string, guestId: string, userId: string): Promise<
  | { ok: true; ref: FirebaseFirestore.DocumentReference; data: any }
  | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }

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

    const loaded = await loadOwnedGuest(id, guestId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    const body = await request.json().catch(() => ({}))
    const parsed = parseGuestInput(body, true)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const updates: Record<string, any> = { ...parsed.value, updated_at: Timestamp.now() }

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
    return NextResponse.json({
      success: true,
      guest: serializeGuest(guestId, { ...loaded.data, ...updates }),
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

    const loaded = await loadOwnedGuest(id, guestId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    await loaded.ref.delete()
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[guests] delete failed', err)
    return NextResponse.json({ error: 'Failed to remove guest' }, { status: 500 })
  }
}
