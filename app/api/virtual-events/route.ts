import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { safeExternalUrl } from '@/lib/safeUrl'
import { liveTicketStatusesForQuery } from '@/lib/tickets/status'

/**
 * Virtual / hybrid event settings.
 *
 * The join links (streaming URL, meeting link) and access instructions are
 * what a ticket buys, so they must NOT sit on the public `events/{id}` doc —
 * anyone can read that. They live in `events/{id}/private/virtual`, which the
 * rules make unreadable to clients, and are served by GET below only to the
 * organizer or a holder of a live ticket.
 */
const PRIVATE_DOC = 'virtual'

function privateRef(eventId: string) {
  return adminDb.collection('events').doc(eventId).collection('private').doc(PRIVATE_DOC)
}

function optionalLink(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null }
  const safe = safeExternalUrl(String(raw))
  return safe ? { ok: true, value: safe } : { ok: false }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { eventId, isVirtual, isHybrid, streamingUrl, meetingLink, platform, accessInstructions } = body || {}

    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    const eventRef = adminDb.collection('events').doc(eventId)
    const snap = await eventRef.get()
    const event = snap.exists ? (snap.data() as any) : null
    if (!event || (event.organizer_id ?? event.organizerId) !== user.id) {
      return NextResponse.json({ error: 'Event not found or unauthorized' }, { status: 404 })
    }

    const streaming = optionalLink(streamingUrl)
    const meeting = optionalLink(meetingLink)
    if (!streaming.ok || !meeting.ok) {
      return NextResponse.json({ error: 'Links must be valid http(s) URLs' }, { status: 400 })
    }

    const batch = adminDb.batch()
    batch.set(
      privateRef(eventId),
      {
        streaming_url: streaming.value,
        meeting_link: meeting.value,
        virtual_access_instructions:
          typeof accessInstructions === 'string' ? accessInstructions.slice(0, 5000) : null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    )
    // Public doc keeps only the non-secret flags; any legacy copies of the
    // links on it are removed.
    batch.update(eventRef, {
      is_virtual: Boolean(isVirtual),
      is_hybrid: Boolean(isHybrid),
      virtual_platform: typeof platform === 'string' ? platform.slice(0, 100) : null,
      streaming_url: FieldValue.delete(),
      meeting_link: FieldValue.delete(),
      virtual_access_instructions: FieldValue.delete(),
      updated_at: new Date().toISOString(),
    })
    await batch.commit()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/virtual-events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Join details for a virtual event — organizer or live-ticket holder only.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const eventId = new URL(req.url).searchParams.get('eventId')
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    const [eventSnap, privSnap] = await Promise.all([
      adminDb.collection('events').doc(eventId).get(),
      privateRef(eventId).get(),
    ])
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const event = eventSnap.data() as any
    const isOrganizer = (event.organizer_id ?? event.organizerId) === user.id

    if (!isOrganizer && user.role !== 'admin') {
      const tickets = await adminDb
        .collection('tickets')
        .where('event_id', '==', eventId)
        .where('attendee_id', '==', user.id)
        .where('status', 'in', liveTicketStatusesForQuery())
        .limit(1)
        .get()
      if (tickets.empty) {
        return NextResponse.json(
          { error: 'You must have a ticket to access virtual event details' },
          { status: 403 }
        )
      }
    }

    // Legacy events may still carry the links on the public doc until the
    // organizer next saves; fall back to them so nothing breaks meanwhile.
    const priv = privSnap.exists ? (privSnap.data() as any) : {}
    return NextResponse.json({
      isVirtual: Boolean(event.is_virtual),
      isHybrid: Boolean(event.is_hybrid),
      streamingUrl: safeExternalUrl(priv.streaming_url ?? event.streaming_url ?? null),
      meetingLink: safeExternalUrl(priv.meeting_link ?? event.meeting_link ?? null),
      platform: event.virtual_platform ?? null,
      accessInstructions: priv.virtual_access_instructions ?? event.virtual_access_instructions ?? null,
    })
  } catch (error) {
    console.error('Error in GET /api/virtual-events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
