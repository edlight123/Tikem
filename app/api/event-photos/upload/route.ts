import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { sniffRasterImage } from '@/lib/security/sniffImage'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * Upload an event photo. Organizer of the event (or an admin) only.
 *
 * Every check runs BEFORE anything is written to Storage: ownership, size, and
 * the bytes themselves (JPEG/PNG/WebP/GIF only — no SVG/HTML served from our
 * bucket). The stored content type and extension come from the sniffed bytes,
 * never the client's file name or declared type.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file')
    const eventId = String(formData.get('eventId') || '').trim()
    const captionRaw = formData.get('caption')
    const caption = typeof captionRaw === 'string' ? captionRaw.slice(0, 500) : null

    if (!(file instanceof File) || !eventId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 10 MB or smaller' }, { status: 413 })
    }

    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const event = eventSnap.data() as any
    if ((event?.organizer_id ?? event?.organizerId) !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 10 MB or smaller' }, { status: 413 })
    }
    const sniffed = sniffRasterImage(buffer)
    if (!sniffed) {
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP or GIF images are allowed' }, { status: 415 })
    }

    let photoUrl: string
    try {
      const bucket = adminStorage.bucket()
      const storagePath = `event-photos/${eventId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${sniffed.ext}`
      const fileRef = bucket.file(storagePath)
      await fileRef.save(buffer, {
        contentType: sniffed.mime,
        resumable: false,
        metadata: { cacheControl: 'public, max-age=31536000' },
      })
      await fileRef.makePublic()
      photoUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`
    } catch (storageError) {
      console.error('Firebase Storage upload error:', storageError)
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
    }

    const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
    await adminDb.collection('event_photos').doc(photoId).set({
      id: photoId,
      event_id: eventId,
      uploaded_by: user.id,
      photo_url: photoUrl,
      caption: caption || null,
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, photoId, photoUrl })
  } catch (error) {
    console.error('Error uploading photo:', error)
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
  }
}
