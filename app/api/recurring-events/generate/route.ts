import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/firebase-db/server'
import { canOnEvent } from '@/lib/organizer/context'
import { generateEventInstances, RecurrenceRule } from '@/lib/recurring-events'

/**
 * Generate event instances from recurrence rule
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { eventId, recurrenceRule } = body as {
      eventId: string
      recurrenceRule: RecurrenceRule
    }

    if (!eventId || !recurrenceRule) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify the caller may run this event (its org team)
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (eventError || !event || !(await canOnEvent(user, event, 'manage_events')).allowed) {
      return NextResponse.json(
        { error: 'Event not found or unauthorized' },
        { status: 404 }
      )
    }

    // Generate instances
    const startDate = new Date(event.date)
    const instances = generateEventInstances(
      eventId,
      startDate,
      event.time || '09:00',
      recurrenceRule,
      100 // Max 100 instances
    )

    if (instances.length === 0) {
      return NextResponse.json(
        { error: 'No instances generated from recurrence rule' },
        { status: 400 }
      )
    }

    // Save instances to database
    const { error: insertError } = await supabase
      .from('event_instances')
      .insert(instances)

    if (insertError) {
      console.error('Error inserting event instances:', insertError)
      return NextResponse.json(
        { error: 'Failed to save event instances' },
        { status: 500 }
      )
    }

    // Update event with recurrence rule
    const { error: updateError } = await supabase
      .from('events')
      .update({
        recurrence_pattern: recurrenceRule.pattern,
        recurrence_interval: recurrenceRule.interval,
        recurrence_days_of_week: recurrenceRule.daysOfWeek,
        recurrence_day_of_month: recurrenceRule.dayOfMonth,
        recurrence_end_date: recurrenceRule.endDate,
        recurrence_occurrences: recurrenceRule.occurrences,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)

    if (updateError) {
      console.error('Error updating event recurrence:', updateError)
    }

    return NextResponse.json({
      success: true,
      instancesGenerated: instances.length,
      instances: instances.slice(0, 10), // Return first 10 for preview
    })
  } catch (error) {
    console.error('Error generating event instances:', error)
    return NextResponse.json(
      { error: 'Failed to generate instances' },
      { status: 500 }
    )
  }
}
