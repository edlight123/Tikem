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

// addToWaitlist / notifyWaitlist used to live here. They read and wrote a
// `waitlist` collection nothing else uses and had no callers; the real
// waitlist (event_waitlist) is lib/waitlist.ts.
