import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminStorage } from '@/lib/firebase/admin'
import { createClient } from '@/lib/firebase-db/server'
import { canOnEvent } from '@/lib/organizer/context'
import { storagePathFromUrl } from '@/lib/firebase/downloadUrl'

/**
 * Get photos for an event
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: photos, error } = await supabase
      .from('event_photos')
      .select('*, users(name)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching photos:', error)
      return NextResponse.json(
        { error: 'Failed to fetch photos' },
        { status: 500 }
      )
    }

    return NextResponse.json({ photos })
  } catch (error) {
    console.error('Error in GET /api/event-photos:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Delete event photo
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const photoId = searchParams.get('photoId')

    if (!photoId) {
      return NextResponse.json(
        { error: 'Photo ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify photo belongs to user or user is event organizer
    const { data: photo } = await supabase
      .from('event_photos')
      .select('*, events(organizer_id)')
      .eq('id', photoId)
      .single()

    if (!photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      )
    }

    const isOrganizer = (await canOnEvent(user, photo.events, 'manage_events')).allowed
    const isUploader = photo.uploaded_by === user.id

    if (!isOrganizer && !isUploader) {
      return NextResponse.json(
        { error: 'Unauthorized to delete this photo' },
        { status: 403 }
      )
    }

    // Delete the file too. Uploads store a download link since PR #32; the
    // old storage.googleapis.com form is still understood.
    if (photo.photo_url) {
      try {
        const bucket = adminStorage.bucket()
        const storagePath = storagePathFromUrl(String(photo.photo_url), bucket.name)
        if (storagePath) {
          await bucket.file(storagePath).delete({ ignoreNotFound: true })
        }
      } catch (storageErr) {
        // Log but don't block DB deletion
        console.error('Error deleting photo from Storage:', storageErr)
      }
    }

    // Delete photo record from database
    const { error: deleteError } = await supabase
      .from('event_photos')
      .delete()
      .eq('id', photoId)

    if (deleteError) {
      console.error('Error deleting photo:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete photo' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/event-photos:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
