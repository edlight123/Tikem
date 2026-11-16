import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { FEEDBACK_COMMENT_MAX, hasCheckedInTicket } from '@/lib/postEvent/server'

export const dynamic = 'force-dynamic'

/**
 * "How was it?" — one rating per attendee per event (doc id = their uid), so
 * answering again just changes it. Only someone who was checked in may rate.
 * Ratings are private: only the organizer side reads them (the recap).
 *
 * GET  → the event basics for the sheet, whether this person may rate, and
 *        their current answer.
 * POST { rating: 1 | 2 | 3, comment?: string }
 */

async function load(eventId: string) {
  const snap = await adminDb.collection('events').doc(eventId).get()
  return snap.exists ? (snap.data() as Record<string, any>) : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAuth()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const eventId = String((await params)?.id || '')
  const event = eventId ? await load(eventId) : null
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const [canRate, mine] = await Promise.all([
    hasCheckedInTicket(eventId, user.id),
    adminDb.collection('events').doc(eventId).collection('feedback').doc(user.id).get(),
  ])
  const f = mine.exists ? mine.data() || {} : null
  return NextResponse.json({
    event: {
      id: eventId,
      title: String(event.title || ''),
      posterUrl: event.banner_image_url || event.cover_image_url || null,
      organizerId: event.organizer_id || null,
      organizerName: event.organizer_name || null,
    },
    canRate,
    feedback: f ? { rating: Number(f.rating) || null, comment: typeof f.comment === 'string' ? f.comment : '' } : null,
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAuth()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const eventId = String((await params)?.id || '')
  const body: any = await request.json().catch(() => null)
  const rating = Number(body?.rating)
  if (!(rating === 1 || rating === 2 || rating === 3)) {
    return NextResponse.json({ error: 'rating must be 1, 2 or 3' }, { status: 400 })
  }
  const comment = typeof body?.comment === 'string' ? body.comment.replace(/\s+/g, ' ').trim().slice(0, FEEDBACK_COMMENT_MAX) : ''

  const event = eventId ? await load(eventId) : null
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (!(await hasCheckedInTicket(eventId, user.id))) {
    return NextResponse.json({ error: 'Only people who attended can rate this event', code: 'not_attended' }, { status: 403 })
  }

  const ref = adminDb.collection('events').doc(eventId).collection('feedback').doc(user.id)
  const existing = await ref.get()
  await ref.set(
    {
      user_id: user.id,
      // Snapshotted for the organizer's recap; no email, no phone.
      user_name: String((user as any).full_name || (user as any).display_name || '').slice(0, 80),
      rating,
      comment,
      updated_at: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { created_at: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  )
  return NextResponse.json({ ok: true })
}
