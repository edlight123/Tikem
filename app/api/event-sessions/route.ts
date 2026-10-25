import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/firebase-db/server'
import { canOnEvent } from '@/lib/organizer/context'

/**
 * Create event session
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      eventId,
      sessionName,
      sessionDate,
      startTime,
      endTime,
      location,
      capacity,
      description,
      speakers,
    } = body

    if (!eventId || !sessionName || !sessionDate || !startTime) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify the caller may run this event (its org team)
    const { data: event } = await supabase
      .from('events')
      .select('id, organizer_id')
      .eq('id', eventId)
      .single()

    if (!event || !(await canOnEvent(user, event, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Event not found or unauthorized' },
        { status: 404 }
      )
    }

    // Create session
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const { error: insertError } = await supabase.from('event_sessions').insert({
      id: sessionId,
      event_id: eventId,
      session_name: sessionName,
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      location: location || null,
      capacity: capacity || null,
      description: description || null,
      speakers: speakers || null,
      created_at: new Date().toISOString(),
    })

    if (insertError) {
      console.error('Error creating session:', insertError)
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, sessionId })
  } catch (error) {
    console.error('Error in POST /api/event-sessions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get sessions for an event
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

    const { data: sessions, error } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('event_id', eventId)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true })

    if (error) {
      console.error('Error fetching sessions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch sessions' },
        { status: 500 }
      )
    }

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Error in GET /api/event-sessions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Update event session
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { sessionId, ...updates } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify ownership
    const { data: session } = await supabase
      .from('event_sessions')
      .select('*, events!inner(organizer_id)')
      .eq('id', sessionId)
      .single()

    if (!session || !(await canOnEvent(user, session.events, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized to modify this session' },
        { status: 403 }
      )
    }

    const { error: updateError } = await supabase
      .from('event_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    if (updateError) {
      console.error('Error updating session:', updateError)
      return NextResponse.json(
        { error: 'Failed to update session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/event-sessions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Delete event session
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify ownership
    const { data: session } = await supabase
      .from('event_sessions')
      .select('*, events!inner(organizer_id)')
      .eq('id', sessionId)
      .single()

    if (!session || !(await canOnEvent(user, session.events, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized to delete this session' },
        { status: 403 }
      )
    }

    const { error: deleteError } = await supabase
      .from('event_sessions')
      .delete()
      .eq('id', sessionId)

    if (deleteError) {
      console.error('Error deleting session:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/event-sessions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
