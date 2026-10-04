import { createClient } from '@/lib/firebase-db/server'

interface CapacityCheck {
  available: boolean
  remaining: number
  isSoldOut: boolean
}

export async function checkEventCapacity(
  eventId: string,
  requestedQuantity: number = 1
): Promise<CapacityCheck> {
  const supabase = await createClient()

  // Read the event's capacity AND its maintained sold counter in a single cheap doc read.
  // (Previously this scanned every ticket row for the event — too expensive to call on a hot
  // purchase path, which is why it was left unused. The counter is the same source of truth the
  // tier checks and the atomic reserve use.)
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single()

  return capacityFromEvent(event, requestedQuantity)
}

/**
 * The same capacity verdict as checkEventCapacity, computed from an event doc the
 * caller has ALREADY loaded — so a checkout route that just read the event does not
 * pay a second Firestore round trip for the identical document.
 */
export function capacityFromEvent(event: any, requestedQuantity: number = 1): CapacityCheck {
  // Capacity sources (0 / missing ⇒ unlimited).
  const capacity = Number(event?.max_tickets ?? event?.capacity ?? event?.total_tickets ?? 0)
  if (!event || !Number.isFinite(capacity) || capacity <= 0) {
    return {
      available: true,
      remaining: Infinity,
      isSoldOut: false,
    }
  }

  const soldTickets = Number(event.tickets_sold || 0)
  const remaining = capacity - soldTickets
  const available = remaining >= requestedQuantity

  return {
    available,
    remaining: Math.max(0, remaining),
    isSoldOut: remaining <= 0,
  }
}

export async function addToWaitlist(
  eventId: string,
  userId: string,
  email: string,
  quantity: number = 1
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('waitlist')
    .insert({
      event_id: eventId,
      user_id: userId,
      email: email,
      quantity: quantity,
      status: 'pending'
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function notifyWaitlist(eventId: string, availableQuantity: number) {
  const supabase = await createClient()

  // Get waitlist entries in order
  const { data: waitlistEntries } = await supabase
    .from('waitlist')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .is('notified_at', null)
    .order('created_at', { ascending: true })

  if (!waitlistEntries || waitlistEntries.length === 0) {
    return
  }

  let notified = 0
  let remainingSlots = availableQuantity

  for (const entry of waitlistEntries) {
    if (remainingSlots <= 0) break
    if (entry.quantity <= remainingSlots) {
      // Notify this person
      await supabase
        .from('waitlist')
        .update({
          status: 'notified',
          notified_at: new Date().toISOString()
        })
        .eq('id', entry.id)

      // Send email notification
      try {
        const { sendEmail, getWaitlistNotificationEmail } = await import('@/lib/email')
        const { data: event } = await supabase
          .from('events')
          .select('title, start_datetime')
          .eq('id', eventId)
          .single()

        if (event) {
          await sendEmail({
            to: entry.email,
            subject: `Tickets Available: ${event.title}`,
            html: getWaitlistNotificationEmail({
              eventTitle: event.title,
              eventDate: event.start_datetime,
              quantity: entry.quantity,
              eventId: eventId
            })
          })

          // Also send SMS if phone number available
          if (entry.phone) {
            try {
              const { sendSms, getWaitlistAvailableSms } = await import('@/lib/sms')
              await sendSms({
                to: entry.phone,
                message: getWaitlistAvailableSms({
                  eventTitle: event.title,
                  quantity: entry.quantity,
                  eventUrl: `${process.env.NEXT_PUBLIC_APP_URL}/events/${eventId}`
                })
              })
            } catch (smsError) {
              console.error('Failed to send SMS notification:', smsError)
              // Continue - email was sent
            }
          }
        }
      } catch (emailError) {
        console.error('Failed to send waitlist notification:', emailError)
      }
      
      remainingSlots -= entry.quantity
      notified++
    }
  }

  return notified
}
