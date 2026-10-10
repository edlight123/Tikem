// API Route: POST /api/events/updates
// Create and optionally send an event update/announcement

import { createClient } from '@/lib/firebase-db/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyEventUpdate } from '@/lib/notifications/helpers'

const updateSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  sendEmail: z.boolean().default(true),
  sendSms: z.boolean().default(false),
  sendNow: z.boolean().default(false) // If false, save as draft
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate request body
    const body = await request.json()
    const validation = updateSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { eventId, title, message, sendEmail, sendSms, sendNow } = validation.data

    // Verify organizer owns this event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, title, organizer_id, organizer_name, banner_image_url, country, city, timezone')
      .eq('id', eventId)
      .eq('organizer_id', user.id)
      .single()

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Event not found or you are not the organizer' },
        { status: 404 }
      )
    }

    // Create update record
    const { data: update, error: updateError } = await supabase
      .from('event_updates')
      .insert({
        event_id: eventId,
        organizer_id: user.id,
        title,
        message,
        send_email: sendEmail,
        send_sms: sendSms
      })
      .select()
      .single()

    if (updateError) {
      console.error('Update creation error:', updateError)
      return NextResponse.json(
        { error: 'Failed to create update' },
        { status: 500 }
      )
    }

    if (!sendNow) {
      return NextResponse.json({
        success: true,
        update,
        status: 'draft'
      })
    }

    // Get all attendees' contact info
    // First get all tickets for this event
    const { data: tickets } = await supabase
      .from('tickets')
      .select('*')
      .eq('event_id', eventId)
      .eq('status', 'active')

    if (!tickets || tickets.length === 0) {
      return NextResponse.json({
        success: true,
        update,
        message: 'No attendees to notify'
      })
    }

    // Get unique attendee IDs
    const attendeeIds = Array.from(new Set(tickets.map((t: any) => t.attendee_id)))
    
    // Fetch attendee details
    const { data: attendeesList } = await supabase
      .from('users')
      .select('*')
    
    const attendees = attendeesList?.filter((u: any) => attendeeIds.includes(u.id)) || []

    if (!attendees || attendees.length === 0) {
      return NextResponse.json({
        success: true,
        update,
        status: 'no_recipients',
        message: 'Update created but no attendees to notify'
      })
    }

    let emailsSent = 0
    let smsSent = 0

    // Send in-app notifications to all attendees
    try {
      const updateType = title.toLowerCase().includes('time') || title.toLowerCase().includes('date') 
        ? 'time' 
        : title.toLowerCase().includes('venue') || title.toLowerCase().includes('location')
        ? 'venue'
        : 'general'

      for (const attendeeId of attendeeIds) {
        try {
          await notifyEventUpdate(
            String(attendeeId),
            eventId,
            event.title,
            updateType
          )
        } catch (notifError) {
          console.error(`Failed to send notification to ${attendeeId}:`, notifError)
          // Continue with others
        }
      }
    } catch (error) {
      console.error('In-app notification batch error:', error)
      // Don't fail the update if notifications fail
    }

    // Send email notifications
    if (sendEmail) {
      try {
        const { sendEmail: sendEmailFn, getEventUpdateEmail, emailSubjects } = await import('@/lib/email')
        const { resolveEmailLang } = await import('@/lib/email-kit/recipient')

        const ev = event as any
        const posterUrl = String(ev.banner_image_url || '').trim() || null
        // The users list above is already in memory, so the organizer's name costs nothing.
        const organizerProfile = (attendeesList || []).find((u: any) => u.id === user.id) as any
        const organizerName =
          String(ev.organizer_name || organizerProfile?.full_name || user.user_metadata?.full_name || '').trim() ||
          undefined

        for (const attendee of attendees) {
          if (!attendee.email) continue
          
          try {
            // Each attendee's profile is already loaded: their language, else the event's region.
            const lang = await resolveEmailLang({ explicit: attendee.language, event: ev })
            await sendEmailFn({
              to: attendee.email,
              subject: emailSubjects.eventUpdate(lang, event.title),
              html: getEventUpdateEmail({
                lang,
                attendeeName: attendee.full_name || '',
                eventTitle: event.title,
                updateTitle: title,
                updateMessage: message,
                eventId: eventId,
                posterUrl,
                organizerName,
              })
            })
            emailsSent++
          } catch (emailError) {
            console.error(`Failed to send email to ${attendee.email}:`, emailError)
            // Continue sending to others
          }
        }

        // Update record with email sent timestamp
        await supabase
          .from('event_updates')
          .update({
            email_sent_at: new Date().toISOString(),
            recipient_count: emailsSent
          })
          .eq('id', update.id)
      } catch (error) {
        console.error('Email batch error:', error)
      }
    }

    // Send SMS notifications
    if (sendSms) {
      try {
        const { sendSms: sendSmsFn, getEventUpdateSms } = await import('@/lib/sms')
        
        for (const attendee of attendees) {
          if (!attendee.phone) continue
          
          try {
            await sendSmsFn({
              to: attendee.phone,
              message: getEventUpdateSms({
                eventTitle: event.title,
                updateMessage: `${title}\n\n${message}`
              })
            })
            smsSent++
          } catch (smsError) {
            console.error(`Failed to send SMS to ${attendee.phone}:`, smsError)
            // Continue sending to others
          }
        }

        // Update record with SMS sent timestamp
        await supabase
          .from('event_updates')
          .update({
            sms_sent_at: new Date().toISOString(),
            recipient_count: Math.max(emailsSent, smsSent)
          })
          .eq('id', update.id)
      } catch (error) {
        console.error('SMS batch error:', error)
      }
    }

    return NextResponse.json({
      success: true,
      update,
      status: 'sent',
      stats: {
        totalRecipients: attendees.length,
        emailsSent,
        smsSent
      }
    })

  } catch (error) {
    console.error('Event update error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET all updates for an event
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return NextResponse.json(
        { error: 'eventId is required' },
        { status: 400 }
      )
    }

    // Check if user has access (either organizer or attendee)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: updates, error } = await supabase
      .from('event_updates')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch updates:', error)
      return NextResponse.json(
        { error: 'Failed to fetch updates' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      updates
    })

  } catch (error) {
    console.error('Fetch updates error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
