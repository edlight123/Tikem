import { generateICSFile } from '@/lib/calendar'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // Fetch event details
    const { data: event, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !event) {
      return new Response('Event not found', { status: 404 })
    }
    // Only a live event is public: a draft, or one moderation rejected or
    // hid, is downloadable by its own organizer and team and no one else.
    const live =
      ((event as any).is_published === true || (event as any).status === 'published') &&
      (event as any).rejected !== true &&
      (event as any).hidden_pending_review !== true
    if (!live) {
      const user = await getCurrentUser()
      if (!user || !(await canOnEvent(user as any, event, 'view')).allowed) {
        return new Response('Event not found', { status: 404 })
      }
    }

    // Generate ICS file
    const icsContent = generateICSFile(event)

    // Return as downloadable file
    return new Response(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${String(event.title || 'event').replace(/[^a-z0-9]/gi, '_')}.ics"`
      }
    })
  } catch (error) {
    console.error('Calendar download error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
