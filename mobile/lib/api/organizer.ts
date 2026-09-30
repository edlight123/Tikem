import { db } from '../../config/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  getDoc,
  doc,
} from 'firebase/firestore';
import {
  CurrencyAmount,
  dominantEventCurrency,
  eventLocationLabel,
  isCountedSale,
  sumRevenueByCurrency,
  ticketPurchaseDate,
} from '../organizerStats';

export interface OrganizerEvent {
  id: string;
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  location: string;
  city: string;
  cover_image_url?: string;
  banner_image_url?: string;
  organizer_id: string;
  is_published: boolean;
  tickets_sold: number;
  total_tickets: number;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  created_at: string;
  updated_at: string;

  // Optional fields used by edit flows / legacy event shapes
  ticket_tiers?: any[];
  category?: string;
  venue_name?: string;
  commune?: string;
  address?: string;
  currency?: string;
}

export interface EventTicketBreakdown {
  ticketsSold: number;
  ticketsCheckedIn: number;
  capacity: number;
  ticketTypes: Array<{
    name: string;
    sold: number;
    capacity: number;
  }>;
}

// Light in-memory cache so re-opening the Manage Event screen (or any subpage
// that needs the event) paints instantly instead of flashing a skeleton while a
// Firestore round-trip completes. Populated on every successful fetch; the
// screen still refreshes in the background so numbers stay live. Session-scoped
// (cleared on app restart) — no persistence needed for the instant-reopen win.
const eventCache = new Map<string, OrganizerEvent>();
const breakdownCache = new Map<string, EventTicketBreakdown>();

export function getCachedEvent(eventId: string): OrganizerEvent | undefined {
  return eventCache.get(eventId);
}

export function getCachedBreakdown(eventId: string): EventTicketBreakdown | undefined {
  return breakdownCache.get(eventId);
}

export interface OrganizerStats {
  totalEvents: number;
  upcomingEvents: number;
  draftEvents: number;
  ticketsSold: number;
  /**
   * Revenue per currency, largest first. Never summed across currencies: an
   * HTG sale and a USD sale are different money. Empty when nothing sold.
   */
  revenueByCurrency: CurrencyAmount[];
  /** Currency to show a zero revenue in (the organizer's usual event currency). */
  defaultCurrency: string;
  avgTicketsPerEvent: number;
  upcomingSoonWithNoSales: number;
}

export interface TodayEvent {
  id: string;
  title: string;
  start_datetime: string;
  /** Composed display location (location, else venue/city); may be ''. */
  location: string;
  /** Poster URL (banner first, then cover, as the attendee side reads it). */
  posterUri: string | null;
  category?: string;
  ticketsSold: number;
  ticketsCheckedIn: number;
  capacity: number;
}

/**
 * Fetch organizer events from Firestore
 */
export async function getOrganizerEvents(
  organizerId: string,
  pageSize: number = 50
): Promise<OrganizerEvent[]> {
  try {
    const q = query(
      collection(db, 'events'),
      where('organizer_id', '==', organizerId),
      orderBy('created_at', 'desc'),
      limit(pageSize)
    );

    const snapshot = await getDocs(q);

    const events = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        start_datetime:
          data.start_datetime instanceof Timestamp
            ? data.start_datetime.toDate().toISOString()
            : data.start_datetime,
        end_datetime:
          data.end_datetime instanceof Timestamp
            ? data.end_datetime.toDate().toISOString()
            : data.end_datetime,
        created_at:
          data.created_at instanceof Timestamp
            ? data.created_at.toDate().toISOString()
            : data.created_at,
        updated_at:
          data.updated_at instanceof Timestamp
            ? data.updated_at.toDate().toISOString()
            : data.updated_at,
      } as OrganizerEvent;
    });

    // Filter out cancelled events
    return events.filter(event => event.status !== 'cancelled');
  } catch (error) {
    console.error('Error fetching organizer events:', error);
    return [];
  }
}

/**
 * Fetch organizer tickets
 */
async function getOrganizerTickets(organizerId: string): Promise<any[]> {
  try {
    // First get all event IDs for this organizer
    const events = await getOrganizerEvents(organizerId, 500);
    const eventIds = events.map((e) => e.id);

    if (eventIds.length === 0) {
      return [];
    }

    // Firestore 'in' query limit is 10, so batch if needed
    const tickets: any[] = [];
    const batchSize = 10;

    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);
      const q = query(
        collection(db, 'tickets'),
        where('event_id', 'in', batch)
      );

      const snapshot = await getDocs(q);
      const batchTickets = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          purchased_at:
            data.purchased_at instanceof Timestamp
              ? data.purchased_at.toDate().toISOString()
              : data.purchased_at,
        };
      });
      tickets.push(...batchTickets);
    }

    return tickets;
  } catch (error) {
    console.error('Error fetching organizer tickets:', error);
    return [];
  }
}

/**
 * Calculate organizer statistics
 */
export async function getOrganizerStats(
  organizerId: string,
  range: '7d' | '30d' | 'lifetime' = '7d'
): Promise<OrganizerStats> {
  try {
    const [events, tickets] = await Promise.all([
      getOrganizerEvents(organizerId, 500),
      getOrganizerTickets(organizerId),
    ]);

    const now = new Date();
    const cutoffDate =
      range === 'lifetime'
        ? new Date(0)
        : range === '30d'
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Only sales count: refunded / cancelled / pending tickets are not revenue.
    const soldTickets = tickets.filter((t: any) => isCountedSale(t.status));

    // Filter tickets by date range. purchased_at is missing on some writers,
    // so ticketPurchaseDate falls back to created_at.
    const filteredTickets = soldTickets.filter((t: any) => {
      const bought = ticketPurchaseDate(t);
      return !!bought && bought >= cutoffDate;
    });

    // Calculate stats
    const totalEvents = events.length;
    const upcomingEvents = events.filter((e: any) => {
      const cutoff = e.end_datetime || e.start_datetime;
      if (!cutoff) return false;
      return new Date(cutoff) > now;
    }).length;
    const draftEvents = events.filter((e) => !e.is_published).length;
    const ticketsSold = filteredTickets.length;
    const eventCurrencyById: Record<string, string | undefined> = {};
    for (const e of events) eventCurrencyById[e.id] = e.currency;
    const revenueByCurrency = sumRevenueByCurrency(filteredTickets, eventCurrencyById);
    const defaultCurrency = dominantEventCurrency(events);
    const avgTicketsPerEvent =
      totalEvents > 0 ? ticketsSold / totalEvents : 0;

    // Find events with 0 sales starting within 7 days
    const sevenDaysFromNow = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );
    const eventsWithTickets = new Set(soldTickets.map((t: any) => t.event_id));
    const upcomingSoonWithNoSales = events.filter((e: any) => {
      if (!e.is_published) return false;
      const start = e.start_datetime ? new Date(e.start_datetime) : null;
      const cutoff = e.end_datetime || e.start_datetime;
      const end = cutoff ? new Date(cutoff) : null;
      if (!start || !end) return false;

      return start <= sevenDaysFromNow && end > now && !eventsWithTickets.has(e.id);
    }).length;

    return {
      totalEvents,
      upcomingEvents,
      draftEvents,
      ticketsSold,
      revenueByCurrency,
      defaultCurrency,
      avgTicketsPerEvent,
      upcomingSoonWithNoSales,
    };
  } catch (error) {
    console.error('Error calculating organizer stats:', error);
    return {
      totalEvents: 0,
      upcomingEvents: 0,
      draftEvents: 0,
      ticketsSold: 0,
      revenueByCurrency: [],
      defaultCurrency: dominantEventCurrency([]),
      avgTicketsPerEvent: 0,
      upcomingSoonWithNoSales: 0,
    };
  }
}

/**
 * Get today's events for organizer
 */
export async function getTodayEvents(
  organizerId: string
): Promise<TodayEvent[]> {
  try {
    const events = await getOrganizerEvents(organizerId, 500);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Filter events happening today (exclude cancelled events)
    const todayEvents = events.filter((e) => {
      const eventDate = new Date(e.start_datetime);
      const isToday = eventDate >= startOfDay && eventDate < endOfDay;
      const isCancelled = e.status === 'cancelled';
      return isToday && !isCancelled;
    });

    // Get ticket data for each event
    const eventsWithTickets = await Promise.all(
      todayEvents.map(async (event) => {
        const base = {
          id: event.id,
          title: event.title,
          start_datetime: event.start_datetime,
          location: eventLocationLabel(event),
          posterUri: event.banner_image_url || event.cover_image_url || null,
          category: event.category,
          ticketsSold: event.tickets_sold || 0,
          capacity: event.total_tickets || 0,
        };
        try {
          // Get checked-in count from tickets collection.
          // NOTE: Avoid `checked_in_at != null` which can require additional ordering/indexing
          // and may fail silently here (caught and returns 0). The scanner sets `checked_in: true`.
          const ticketsQuery = query(
            collection(db, 'tickets'),
            where('event_id', '==', event.id),
            where('checked_in', '==', true)
          );
          const checkedInSnapshot = await getDocs(ticketsQuery);

          return { ...base, ticketsCheckedIn: checkedInSnapshot.size };
        } catch (error) {
          console.error(`Error fetching tickets for event ${event.id}:`, error);
          return { ...base, ticketsCheckedIn: 0 };
        }
      })
    );

    return eventsWithTickets;
  } catch (error) {
    console.error('Error fetching today events:', error);
    return [];
  }
}

/**
 * Get single event details
 */
export async function getEventById(eventId: string): Promise<OrganizerEvent | null> {
  try {
    const eventDoc = await getDoc(doc(db, 'events', eventId));

    if (!eventDoc.exists()) {
      return null;
    }

    const data = eventDoc.data();
    const event = {
      id: eventDoc.id,
      ...data,
      start_datetime:
        data.start_datetime instanceof Timestamp
          ? data.start_datetime.toDate().toISOString()
          : data.start_datetime,
      end_datetime:
        data.end_datetime instanceof Timestamp
          ? data.end_datetime.toDate().toISOString()
          : data.end_datetime,
      created_at:
        data.created_at instanceof Timestamp
          ? data.created_at.toDate().toISOString()
          : data.created_at,
      updated_at:
        data.updated_at instanceof Timestamp
          ? data.updated_at.toDate().toISOString()
          : data.updated_at,
    } as OrganizerEvent;

    eventCache.set(eventId, event);
    return event;
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
}

/**
 * Get ticket breakdown for an event
 */
export async function getEventTicketBreakdown(eventId: string): Promise<EventTicketBreakdown> {
  try {
    const [event, ticketsSnapshot, tiersSnapshot] = await Promise.all([
      getEventById(eventId),
      getDocs(query(collection(db, 'tickets'), where('event_id', '==', eventId))),
      getDocs(query(collection(db, 'ticket_tiers'), where('event_id', '==', eventId))),
    ]);

    if (!event) {
      return {
        ticketsSold: 0,
        ticketsCheckedIn: 0,
        capacity: 0,
        ticketTypes: [],
      };
    }

    const tickets = ticketsSnapshot.docs.map((doc) => doc.data());
    const tiers = tiersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    
    // Use tickets_sold from event document (same as webapp)
    const ticketsSold = event.tickets_sold || 0;
    const ticketsCheckedIn = tickets.filter((t) => t.checked_in_at).length;

    // Group tickets by tier and get capacities from ticket_tiers
    const tierMap = new Map<string, { sold: number; capacity: number }>();
    
    // Initialize with tier data.
    // NOTE: ticket tiers store capacity as `total_quantity` (see /api/ticket-tiers and
    // every sold-out check). The old `tier.quantity` field doesn't exist, which made every
    // tier show a capacity of 0. Fall back to `quantity` only for any legacy docs.
    tiers.forEach((tier: any) => {
      tierMap.set(tier.name, {
        sold: 0,
        capacity: Number(tier.total_quantity ?? tier.quantity ?? 0),
      });
    });
    
    // Count sold tickets per tier
    tickets.forEach((ticket) => {
      const tierName = ticket.tier_name || ticket.ticket_tier_name || 'General Admission';
      if (tierMap.has(tierName)) {
        const tier = tierMap.get(tierName)!;
        tier.sold += 1;
      } else {
        // If tier not found in tiers collection, create entry
        tierMap.set(tierName, { sold: 1, capacity: 1 });
      }
    });

    const ticketTypes = Array.from(tierMap.entries()).map(([name, data]) => ({
      name,
      sold: data.sold,
      capacity: data.capacity,
    }));

    const breakdown: EventTicketBreakdown = {
      ticketsSold,
      ticketsCheckedIn,
      capacity: event.total_tickets || 0,
      ticketTypes,
    };
    breakdownCache.set(eventId, breakdown);
    return breakdown;
  } catch (error) {
    console.error('Error fetching event ticket breakdown:', error);
    return {
      ticketsSold: 0,
      ticketsCheckedIn: 0,
      capacity: 0,
      ticketTypes: [],
    };
  }
}
