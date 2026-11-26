import { adminDb } from '@/lib/firebase/admin'
import { normalizeCurrency } from '@/lib/money'

/**
 * Get all events for a specific organizer
 */
export async function getOrganizerEvents(organizerId: string) {
  try {
    const eventsSnapshot = await adminDb
      .collection('events')
      .where('organizer_id', '==', organizerId)
      .get()

    const events = eventsSnapshot.docs.map((doc: any) => {
      const data = doc.data()
      
      // Helper function to convert any value that might be a Firestore Timestamp
      const convertTimestamp = (value: any, fallback: string = new Date().toISOString()): string => {
        if (!value) return fallback
        if (value.toDate && typeof value.toDate === 'function') {
          return value.toDate().toISOString()
        }
        if (typeof value === 'string') return value
        if (value instanceof Date) return value.toISOString()
        try {
          return new Date(value).toISOString()
        } catch {
          return fallback
        }
      }
      
      // Convert all potential Firestore Timestamps to ISO strings
      const startDateTime = convertTimestamp(data.start_datetime)
      const endDateTime = convertTimestamp(data.end_datetime)
      const createdAt = convertTimestamp(data.created_at)
      const updatedAt = convertTimestamp(data.updated_at)
      
      return {
        id: doc.id,
        title: data.title,
        description: data.description,
        start_datetime: startDateTime,
        end_datetime: endDateTime,
        venue_name: data.venue_name || '',
        venue_address: data.venue_address || '',
        city: data.city || data.commune || '',
        commune: data.commune || data.city || '',
        price: data.price || 0,
        currency: normalizeCurrency(data.currency, 'HTG'),
        max_attendees: data.max_attendees || 0,
        total_tickets: data.total_tickets || 0,
        banner_image_url: data.banner_image || data.banner_image_url || '',
        category: data.category || '',
        status: data.is_published ? 'published' : 'draft',
        is_published: data.is_published ?? data.status === 'published',
        // Visibility (lib/events/visibility): false = unlisted.
        show_on_explore: data.show_on_explore === false ? false : undefined,
        created_at: createdAt,
        updated_at: updatedAt,
        organizer_id: data.organizer_id
      }
    })
    
    // Sort by created_at in memory (descending - newest first)
    events.sort((a: any, b: any) => {
      const dateA = new Date(a.created_at).getTime()
      const dateB = new Date(b.created_at).getTime()
      return dateB - dateA
    })
    
    return events
  } catch (error) {
    console.error('Error fetching organizer events:', error)
    return []
  }
}

/**
 * Get tickets sold for organizer's events
 */
/**
 * Aggregate the organizer's customers across all their events: a flat order
 * list (one row per ticket) and a de-duplicated attendee list with lifetime
 * stats. Used by the org-level Orders and Marketing pages.
 */
export async function getOrganizerCustomers(organizerId: string) {
  try {
    const events = await getOrganizerEvents(organizerId)
    const eventTitleById = new Map<string, string>(events.map((e: any) => [e.id, e.title || 'Untitled event']))
    const tickets = await getOrganizerTickets(organizerId)

    // Resolve buyer details by document reference (getAll) rather than a
    // `where('__name__', 'in', batch)` query: filtering on the documentId
    // requires Key values, not bare id strings, so passing plain ids throws
    // "__key__ filter value must be a Key". getAll takes plain refs, has no
    // 10-item cap, and returns missing docs with `exists === false`.
    const userIds = Array.from(new Set(tickets.map((t: any) => t.user_id).filter(Boolean))) as string[]
    const userById = new Map<string, { name: string; email: string; phone: string }>()
    if (userIds.length > 0) {
      const refs = userIds.map((id) => adminDb.collection('users').doc(id))
      const docs = await adminDb.getAll(...refs)
      docs.forEach((doc: any) => {
        if (!doc.exists) return
        const d = doc.data()
        userById.set(doc.id, {
          name: d.full_name || d.display_name || d.displayName || 'Guest',
          email: d.email || '',
          phone: d.phone || d.phone_number || '',
        })
      })
    }

    const resolveBuyer = (t: any) => {
      const doc = userById.get(t.user_id)
      return {
        name: doc?.name || t.user_name || 'Guest',
        email: doc?.email || t.user_email || '',
        phone: doc?.phone || '',
      }
    }

    const orders = tickets
      .map((t: any) => {
        const u = resolveBuyer(t)
        return {
          id: t.id,
          eventTitle: eventTitleById.get(String(t.event_id)) || 'Untitled event',
          attendeeName: u.name,
          attendeeEmail: u.email,
          amount: t.price_paid || 0,
          currency: t.currency,
          status: t.status || 'valid',
          purchasedAt: t.purchased_at,
        }
      })
      .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime())

    const attendeeMap = new Map<string, any>()
    for (const t of tickets) {
      const u = resolveBuyer(t)
      const key = t.user_id || `${u.email}-${u.name}`
      const existing = attendeeMap.get(key)
      const spend = existing?.spendByCurrency || {}
      spend[t.currency] = (spend[t.currency] || 0) + (t.price_paid || 0)
      attendeeMap.set(key, {
        id: key,
        name: u.name,
        email: u.email,
        phone: u.phone,
        ticketCount: (existing?.ticketCount || 0) + 1,
        spendByCurrency: spend,
        lastPurchase:
          !existing || new Date(t.purchased_at) > new Date(existing.lastPurchase)
            ? t.purchased_at
            : existing.lastPurchase,
      })
    }
    const attendees = Array.from(attendeeMap.values()).sort(
      (a, b) => new Date(b.lastPurchase).getTime() - new Date(a.lastPurchase).getTime()
    )

    return { orders, attendees }
  } catch (error) {
    console.error('Error aggregating organizer customers:', error)
    return { orders: [], attendees: [] }
  }
}

export async function getOrganizerTickets(organizerId: string) {
  try {
    // First get all event IDs for this organizer
    const events = await getOrganizerEvents(organizerId)
    const eventCurrencyById = new Map<string, string>(events.map((e: any) => [e.id, normalizeCurrency(e.currency, 'HTG')]))
    const eventIds = events.map((e: any) => e.id)

    if (eventIds.length === 0) {
      return []
    }

    // Firestore 'in' queries limited to 10 items, so batch if needed
    const batchSize = 10
    const batches = []
    
    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize)
      const ticketsSnapshot = await adminDb
        .collection('tickets')
        .where('event_id', 'in', batch)
        .get()
      
      batches.push(ticketsSnapshot)
    }

    // Helper function to convert any value that might be a Firestore Timestamp
    const convertTimestamp = (value: any, fallback: string = new Date().toISOString()): string => {
      if (!value) return fallback
      if (value.toDate && typeof value.toDate === 'function') {
        return value.toDate().toISOString()
      }
      if (typeof value === 'string') return value
      if (value instanceof Date) return value.toISOString()
      try {
        return new Date(value).toISOString()
      } catch {
        return fallback
      }
    }

    const allTickets: any[] = []
    batches.forEach(snapshot => {
      snapshot.docs.forEach((doc: any) => {
        const data = doc.data()
        const eventCurrency = eventCurrencyById.get(String(data.event_id))
        // IMPORTANT: For organizer-facing revenue, use the event currency (aka original currency)
        // when available, regardless of what currency the customer was charged.
        const currency = normalizeCurrency(
          data.original_currency || data.originalCurrency || data.currency || eventCurrency,
          'HTG'
        )
        
        allTickets.push({
          id: doc.id,
          event_id: data.event_id,
          user_id: data.user_id,
          // Denormalized buyer details captured at purchase (covers guest checkout).
          user_name: data.user_name || data.attendee_name || data.buyer_name || '',
          user_email: data.user_email || data.attendee_email || data.buyer_email || '',
          price_paid: data.price_paid || 0,
          currency,
          status: data.status || 'valid',
          purchased_at: convertTimestamp(data.purchased_at, convertTimestamp(data.created_at)),
          created_at: convertTimestamp(data.created_at),
          updated_at: convertTimestamp(data.updated_at),
          checked_in: data.checked_in || false
        })
      })
    })

    return allTickets
  } catch (error) {
    console.error('Error fetching organizer tickets:', error)
    return []
  }
}

/**
 * Get organizer sales statistics
 */
export async function getOrganizerStats(organizerId: string, range: '7d' | '30d' | 'lifetime' = '7d') {
  try {
    const [events, tickets] = await Promise.all([
      getOrganizerEvents(organizerId),
      getOrganizerTickets(organizerId)
    ])

    const now = new Date()
    const cutoffDate = range === 'lifetime' ? new Date(0) : 
                      range === '30d' ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) :
                      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Filter tickets by date range and status
    const filteredTickets = tickets.filter((t: any) => {
      if (String(t.status || '').toLowerCase() !== 'valid') return false
      return new Date(t.purchased_at) >= cutoffDate
    })

    // Calculate stats
    const totalEvents = events.length
    const upcomingEvents = events.filter((e: any) => new Date(e.start_datetime) > now).length
    const draftEvents = events.filter((e: any) => !e.is_published).length
    const ticketsSold = filteredTickets.length
    const revenue = filteredTickets.reduce((sum: number, t: any) => sum + Math.round((t.price_paid || 0) * 100), 0)

    const revenueByCurrencyCents = filteredTickets.reduce((acc: Record<string, number>, t: any) => {
      const currency = normalizeCurrency(t.currency, 'HTG')
      const cents = Math.round((t.price_paid || 0) * 100)
      acc[currency] = (acc[currency] || 0) + cents
      return acc
    }, {})
    const avgTicketsPerEvent = totalEvents > 0 ? ticketsSold / totalEvents : 0

    // Find events with 0 sales starting within 7 days
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const eventsWithTickets = new Set(tickets.map((t: any) => t.event_id))
    const upcomingSoonWithNoSales = events.filter((e: any) =>
      e.is_published &&
      new Date(e.start_datetime) > now && 
      new Date(e.start_datetime) <= sevenDaysFromNow &&
      !eventsWithTickets.has(e.id)
    )

    return {
      totalEvents,
      upcomingEvents,
      draftEvents,
      ticketsSold,
      revenue,
      revenueByCurrencyCents,
      avgTicketsPerEvent,
      upcomingSoonWithNoSales: upcomingSoonWithNoSales.length,
      events,
      tickets: filteredTickets
    }
  } catch (error) {
    console.error('Error calculating organizer stats:', error)
    return {
      totalEvents: 0,
      upcomingEvents: 0,
      draftEvents: 0,
      ticketsSold: 0,
      revenue: 0,
      avgTicketsPerEvent: 0,
      upcomingSoonWithNoSales: 0,
      events: [],
      tickets: []
    }
  }
}

/**
 * Get next upcoming event for organizer
 */
export async function getNextEvent(organizerId: string) {
  try {
    const events = await getOrganizerEvents(organizerId)
    const now = new Date()
    
    const upcomingEvents = events
      .filter((e: any) => new Date(e.start_datetime) > now)
      .sort((a: any, b: any) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())

    if (upcomingEvents.length === 0) {
      return null
    }

    const nextEvent = upcomingEvents[0]
    
    // Get tickets for this specific event
    const ticketsSnapshot = await adminDb
      .collection('tickets')
      .where('event_id', '==', nextEvent.id)
      .get()

    const tickets = ticketsSnapshot.docs.map((doc: any) => {
      const data = doc.data()
      // Prefer original currency (event currency) over charged currency.
      const currency = normalizeCurrency(
        data.original_currency || data.originalCurrency || data.currency || nextEvent.currency,
        'HTG'
      )
      return {
        id: doc.id,
        price_paid: data.price_paid || 0,
        currency,
        status: data.status || 'valid',
        checked_in: data.checked_in || false
      }
    })

    const validTickets = tickets.filter((t: any) => String(t.status || '').toLowerCase() === 'valid')
    const ticketsSold = validTickets.length
    const revenue = validTickets.reduce((sum: number, t: any) => sum + Math.round((t.price_paid || 0) * 100), 0)
    const revenueByCurrencyCents = validTickets.reduce((acc: Record<string, number>, t: any) => {
      const currency = normalizeCurrency(t.currency, 'HTG')
      const cents = Math.round((t.price_paid || 0) * 100)
      acc[currency] = (acc[currency] || 0) + cents
      return acc
    }, {})
    const checkedInCount = tickets.filter((t: any) => t.checked_in).length

    return {
      ...nextEvent,
      ticketsSold,
      revenue,
      revenueByCurrencyCents,
      checkedInCount,
      capacity: nextEvent.total_tickets || nextEvent.max_attendees || 0
    }
  } catch (error) {
    console.error('Error fetching next event:', error)
    return null
  }
}

/**
 * Get event with ticket statistics
 */
export async function getEventWithStats(eventId: string) {
  try {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    
    if (!eventDoc.exists) {
      return null
    }

    const data = eventDoc.data()!
    
    // Helper function to convert any value that might be a Firestore Timestamp
    const convertTimestamp = (value: any, fallback: string = new Date().toISOString()): string => {
      if (!value) return fallback
      if (value.toDate && typeof value.toDate === 'function') {
        return value.toDate().toISOString()
      }
      if (typeof value === 'string') return value
      if (value instanceof Date) return value.toISOString()
      try {
        return new Date(value).toISOString()
      } catch {
        return fallback
      }
    }
    
    // Get tickets for this event
    const ticketsSnapshot = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .get()

    const tickets = ticketsSnapshot.docs.map((doc: any) => {
      const data = doc.data()
      
      return {
        id: doc.id,
        price_paid: data.price_paid || 0,
        status: data.status || 'active',
        checked_in: data.checked_in || false,
        purchased_at: convertTimestamp(data.purchased_at, convertTimestamp(data.created_at)),
        created_at: convertTimestamp(data.created_at),
        updated_at: convertTimestamp(data.updated_at)
      }
    })

    const ticketsSold = tickets.length
    const revenue = tickets.reduce((sum: number, t: any) => sum + (t.price_paid || 0), 0)
    const checkedInCount = tickets.filter((t: any) => t.checked_in).length

    // Convert Firestore Timestamps to ISO strings
    const startDateTime = convertTimestamp(data.start_datetime)
    const endDateTime = convertTimestamp(data.end_datetime)
    const createdAt = convertTimestamp(data.created_at)
    const updatedAt = convertTimestamp(data.updated_at)

    return {
      id: eventDoc.id,
      title: data.title,
      description: data.description,
      start_datetime: startDateTime,
      end_datetime: endDateTime,
      venue_name: data.venue_name || '',
      venue_address: data.venue_address || '',
      city: data.city || data.commune || '',
      commune: data.commune || data.city || '',
      price: data.price || 0,
      max_attendees: data.max_attendees || 0,
      banner_image_url: data.banner_image || data.banner_image_url || '',
      category: data.category || '',
      status: data.status || 'draft',
      is_published: data.is_published ?? data.status === 'published',
      created_at: createdAt,
      updated_at: updatedAt,
      ticketsSold,
      revenue,
      checkedInCount,
      capacity: data.max_attendees || 0
    }
  } catch (error) {
    console.error('Error fetching event with stats:', error)
    return null
  }
}
