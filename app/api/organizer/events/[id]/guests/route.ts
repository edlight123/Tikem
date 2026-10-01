// Organizer guest list for one event: list it, and add a guest. The web page's
// invite drawer has always POSTed here, but the route did not exist, so every
// web invite failed; the mobile guest-list screen uses the same route.
// Guests live in the events/{id}/guests sub-collection, which has no client
// rules, so every read and write goes through the Admin SDK behind the same
// ownership check as promoters.

import { NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { parseGuestInput, serializeGuest } from '@/lib/guest-list'

async function assertEventOwnedByUser(eventId: string, userId: string): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }
  return { ok: true }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ownership = await assertEventOwnedByUser(id, user.id)
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

    const guests = snap.docs.map((d: any) => serializeGuest(d.id, d.data()))
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
    if (user.role !== 'organizer' && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const ownership = await assertEventOwnedByUser(id, user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseGuestInput(body, false)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const guestsRef = adminDb.collection('events').doc(id).collection('guests')
    const existing = await guestsRef.where('email', '==', parsed.value.email).limit(1).get()
    if (!existing.empty) {
      return NextResponse.json({ error: 'This guest is already on the list' }, { status: 409 })
    }

    // invited_at is a Timestamp: the web page orders on it and reads .toDate(),
    // so a doc without it would silently drop off that page.
    const now = Timestamp.now()
    const guestData = {
      name: parsed.value.name,
      email: parsed.value.email,
      plus_one: parsed.value.plus_one === true,
      status: 'invited',
      checked_in: false,
      invited_at: now,
      invited_by: user.id,
      updated_at: now,
    }

    const ref = await guestsRef.add(guestData)
    return NextResponse.json(
      { success: true, guest: serializeGuest(ref.id, guestData) },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('[guests] create failed', err)
    return NextResponse.json({ error: 'Failed to add guest' }, { status: 500 })
  }
}
