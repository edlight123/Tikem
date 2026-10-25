import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'

/**
 * Get event instances for a recurring event
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')
    const status = searchParams.get('status') // Filter by status
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!eventId) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    let query = supabase
      .from('event_instances')
      .select('*')
      .eq('parent_event_id', eventId)
      .order('instance_date', { ascending: true })

    if (status) {
      query = query.eq('status', status)
    }

    if (fromDate) {
      query = query.gte('instance_date', fromDate)
    }

    if (toDate) {
      query = query.lte('instance_date', toDate)
    }

    const { data: instances, error } = await query

    if (error) {
      console.error('Error fetching event instances:', error)
      return NextResponse.json(
        { error: 'Failed to fetch instances' },
        { status: 500 }
      )
    }

    return NextResponse.json({ instances })
  } catch (error) {
    console.error('Error in GET /api/recurring-events/instances:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Update an event instance (cancel, reschedule, modify capacity/price)
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { instanceId, status, capacityOverride, priceOverride, newDate, newTime } = body

    if (!instanceId) {
      return NextResponse.json(
        { error: 'Instance ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify user owns the parent event
    const { data: instance } = await supabase
      .from('event_instances')
      .select('*, events!inner(organizer_id)')
      .eq('id', instanceId)
      .single()

    if (!instance || !(await canOnEvent(user, instance.events, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized to modify this instance' },
        { status: 403 }
      )
    }

    // Build update object
    const updates: any = {
      updated_at: new Date().toISOString(),
    }

    if (status) updates.status = status
    if (capacityOverride !== undefined) updates.capacity_override = capacityOverride
    if (priceOverride !== undefined) updates.price_override = priceOverride
    if (newDate) updates.instance_date = newDate
    if (newTime) updates.instance_time = newTime

    const { error: updateError } = await supabase
      .from('event_instances')
      .update(updates)
      .eq('id', instanceId)

    if (updateError) {
      console.error('Error updating instance:', updateError)
      return NextResponse.json(
        { error: 'Failed to update instance' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/recurring-events/instances:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Delete event instance
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const instanceId = searchParams.get('instanceId')

    if (!instanceId) {
      return NextResponse.json(
        { error: 'Instance ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify ownership
    const { data: instance } = await supabase
      .from('event_instances')
      .select('*, events!inner(organizer_id)')
      .eq('id', instanceId)
      .single()

    if (!instance || !(await canOnEvent(user, instance.events, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Unauthorized to delete this instance' },
        { status: 403 }
      )
    }

    const { error: deleteError } = await supabase
      .from('event_instances')
      .delete()
      .eq('id', instanceId)

    if (deleteError) {
      console.error('Error deleting instance:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete instance' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/recurring-events/instances:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
