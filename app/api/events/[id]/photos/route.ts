/**
 * The event's photo gallery once it has started (lib/postEvent/photos), and
 * what comes next from the same organizer.
 *
 *   GET    → { photos (approved), pending (organizer side only), canAdd,
 *              isManager, mine (how many I added), nextEvent }
 *   POST   multipart { file, caption? } → someone who went (a live or scanned
 *              ticket) adds a photo. The route stores the file itself, after
 *              sniffing its bytes; it waits for the organizer side.
 *   PATCH  { photoId, status: 'approved' | 'rejected' } → the organizer side
 *              (canOnEvent manage_events on the EVENT's own org) or a Tikèm
 *              admin. A rejected photo is deleted, file included.
 *
 * Uploaders' uids never leave the server; the organizer side sees a first name
 * on pending photos, the public sees only the photo and its caption.
 */
import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'
import { downloadUrl } from '@/lib/firebase/downloadUrl'
import { sniffRasterImage } from '@/lib/security/sniffImage'
import {
  MAX_EVENT_PHOTO_BYTES,
  MAX_EVENT_PHOTOS_PER_PERSON,
  cleanCaption,
  nextEventByOrganizer,
  parseReview,
  photoWindowOpen,
  ticketShowsAttendance,
} from '@/lib/postEvent/photos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID = /^[A-Za-z0-9_-]{1,200}$/

async function loadEvent(id: string): Promise<Record<string, any> | null> {
  if (!ID.test(id)) return null
  const snap = await adminDb.collection('events').doc(id).get()
  return snap.exists ? { id: snap.id, ...(snap.data() as Record<string, any>) } : null
}

/** A ticket for this event that shows the person went (or holds a seat). */
async function wentToEvent(eventId: string, uid: string): Promise<boolean> {
  for (const field of ['attendee_id', 'user_id']) {
    const snap = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where(field, '==', uid)
      .limit(10)
      .get()
      .catch(() => null)
    if (snap?.docs?.some((d: any) => ticketShowsAttendance(d.data()))) return true
  }
  return false
}

async function isManager(user: any, event: Record<string, any>): Promise<boolean> {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'super_admin') return true
  return (await canOnEvent(user, event as any, 'manage_events').catch(() => ({ allowed: false }))).allowed
}

const firstName = (name: unknown) => String(name || '').trim().split(/\s+/)[0]?.slice(0, 40) || ''

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await loadEvent(id)
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  const user = await getCurrentUser().catch(() => null)
  const now = Date.now()
  const [photosSnap, manager, nextSnap] = await Promise.all([
    adminDb.collection('events').doc(id).collection('photos').limit(200).get().catch(() => null),
    isManager(user, event),
    event.organizer_id
      ? adminDb.collection('events').where('organizer_id', '==', String(event.organizer_id)).limit(100).get().catch(() => null)
      : null,
  ])
  // Newest first, in memory: an orderBy would drop any doc missing the field.
  const all = ((photosSnap?.docs || []) as any[])
    .map((d) => ({ id: d.id, ...(d.data() || {}) }) as Record<string, any>)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const next = nextEventByOrganizer(((nextSnap?.docs || []) as any[]).map((d) => ({ id: d.id, ...d.data() })), id, now)
  const open = photoWindowOpen(event, now)
  const canAdd = !!user && open && (manager || (await wentToEvent(id, user.id)))
  const startIso = (v: any) => (typeof v?.toDate === 'function' ? v.toDate().toISOString() : v ? String(v) : null)

  return NextResponse.json(
    {
      photos: all
        .filter((p) => p.status === 'approved' && p.url)
        .map((p) => ({ id: p.id, url: String(p.url), caption: p.caption || null })),
      pending: manager
        ? all
            .filter((p) => p.status === 'pending' && p.url)
            .map((p) => ({ id: p.id, url: String(p.url), caption: p.caption || null, user_name: firstName(p.user_name) }))
        : [],
      isManager: manager,
      canAdd,
      mine: user ? all.filter((p) => p.user_id === user.id).length : 0,
      maxPerPerson: MAX_EVENT_PHOTOS_PER_PERSON,
      nextEvent: next
        ? {
            id: next.id,
            title: String(next.title || ''),
            start_datetime: startIso(next.start_datetime),
            banner_image_url: next.banner_image_url || next.cover_image_url || null,
            venue_name: next.venue_name || '',
            city: next.city || '',
            country: next.country || null,
            timezone: next.timezone || null,
          }
        : null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to add photos.', code: 'unauthorized' }, { status: 401 })
  const event = await loadEvent(id)
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (!photoWindowOpen(event, Date.now())) {
    return NextResponse.json({ error: 'Photos can be added from the start of the event.', code: 'window_closed' }, { status: 409 })
  }
  const manager = await isManager(user, event)
  if (!manager && !(await wentToEvent(id, user.id))) {
    return NextResponse.json({ error: 'Only people who went can add photos.', code: 'not_attended' }, { status: 403 })
  }

  const col = adminDb.collection('events').doc(id).collection('photos')
  const mine = await col.where('user_id', '==', user.id).limit(MAX_EVENT_PHOTOS_PER_PERSON + 1).get()
  if (mine.size >= MAX_EVENT_PHOTOS_PER_PERSON) {
    return NextResponse.json({ error: 'You have added the most photos allowed.', code: 'too_many' }, { status: 429 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a photo.', code: 'no_file' }, { status: 400 })
  if (file.size > MAX_EVENT_PHOTO_BYTES) return NextResponse.json({ error: 'Photo too large.', code: 'too_large' }, { status: 413 })
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_EVENT_PHOTO_BYTES) return NextResponse.json({ error: 'Photo too large.', code: 'too_large' }, { status: 413 })
  const sniffed = sniffRasterImage(buffer)
  if (!sniffed) return NextResponse.json({ error: 'JPEG, PNG or WebP only.', code: 'bad_type' }, { status: 415 })

  const ref = col.doc()
  const storagePath = `event-photos/${id}/attendees/${user.id}/${ref.id}.${sniffed.ext}`
  let url: string
  try {
    const fileRef = adminStorage.bucket().file(storagePath)
    await fileRef.save(buffer, {
      contentType: sniffed.mime,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000' },
    })
    url = await downloadUrl(fileRef)
  } catch (err) {
    console.error('[event photos] upload failed', err)
    return NextResponse.json({ error: 'Upload failed.', code: 'upload_failed' }, { status: 500 })
  }

  const status = manager ? 'approved' : 'pending'
  await ref.set({
    url,
    storage_path: storagePath,
    caption: cleanCaption(form?.get('caption')),
    user_id: user.id,
    user_name: String((user as any).full_name || '').slice(0, 80),
    // The organizer side's own photos need no review.
    status,
    created_at: new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, id: ref.id, status })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const event = await loadEvent(id)
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (!(await isManager(user, event))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const review = parseReview(await request.json().catch(() => null))
  if (!review) return NextResponse.json({ error: 'Pick approve or remove.' }, { status: 400 })
  const ref = adminDb.collection('events').doc(id).collection('photos').doc(review.photoId)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (review.status === 'rejected') {
    const path = String(snap.data()?.storage_path || '')
    if (path.startsWith(`event-photos/${id}/`)) {
      await adminStorage.bucket().file(path).delete({ ignoreNotFound: true }).catch(() => undefined)
    }
    await ref.delete()
    return NextResponse.json({ ok: true, removed: true })
  }
  await ref.update({ status: 'approved', reviewed_by: user.id, reviewed_at: FieldValue.serverTimestamp() })
  return NextResponse.json({ ok: true })
}
