import { backendJson } from './backend';

/**
 * Organizer per-event Orders + Analytics. Shapes mirror the server's
 * lib/organizer/eventOrders.ts; the routes are:
 *   GET  /api/organizer/events/:id/orders
 *   GET  /api/organizer/events/:id/analytics
 *   POST /api/resend-ticket   { ticketIds }
 *   POST /api/refund-ticket   { ticketIds }
 * (the last two are the same routes the web attendee drawer calls with
 * `{ ticketId }`).
 */

export interface MoneyLine {
  currency: string;
  amount: number;
}

export type RefundPlan =
  | { eligible: true; rail: 'stripe' | 'stripe_connect' | 'manual'; amount: number; currency: string; paymentRef: string | null }
  | {
      eligible: false;
      reason: 'free' | 'not_live' | 'already_refunded' | 'refund_in_progress' | 'no_payment_reference' | 'amount_unknown';
    };

export type OrderStatus = 'paid' | 'free' | 'refunded' | 'refund_pending' | 'partially_refunded' | 'cancelled';

export interface EventOrder {
  id: string;
  quantity: number;
  liveCount: number;
  checkedInCount: number;
  buyer: { name: string; email: string; city: string };
  isGuest: boolean;
  tiers: { name: string; count: number }[];
  amounts: MoneyLine[];
  paymentMethod: string;
  status: OrderStatus;
  purchasedAt: string;
  tickets: {
    id: string;
    tierName: string;
    pricePaid: number;
    currency: string;
    status: string;
    checkedInAt: string;
    refund: RefundPlan;
  }[];
  refund: { eligibleTicketIds: string[]; totals: MoneyLine[]; rails: string[] };
  canResend: boolean;
}

export interface EventOrdersResponse {
  event: { id: string; title: string; currency: string; status: string | null };
  orders: EventOrder[];
}

export interface EventAnalytics {
  ticketsSold: number;
  capacity: number;
  checkedIn: number;
  checkInRate: number;
  revenue: MoneyLine[];
  salesByDay: { date: string; count: number }[];
  tiers: { name: string; sold: number; revenue: MoneyLine[] }[];
  cities: { city: string; buyers: number }[];
  buyersWithoutCity: number;
  totalBuyers: number;
}

export interface EventAnalyticsResponse {
  event: { id: string; title: string; currency: string };
  analytics: EventAnalytics;
}

export interface RefundResult {
  refunded: { ticketId: string; amount: number; currency: string }[];
  queued: { ticketId: string; amount: number; currency: string }[];
  failed: { ticketId: string; reason: string }[];
  skipped: { ticketId: string; reason: string }[];
}

// Last response per event, so the order detail and a re-opened list paint
// instantly while the fresh copy loads.
const ordersCache = new Map<string, EventOrdersResponse>();

export function getCachedEventOrders(eventId: string): EventOrdersResponse | undefined {
  return ordersCache.get(eventId);
}

export async function fetchEventOrders(eventId: string): Promise<EventOrdersResponse> {
  const res = await backendJson<EventOrdersResponse>(`/api/organizer/events/${encodeURIComponent(eventId)}/orders`);
  const safe: EventOrdersResponse = {
    event: res?.event ?? { id: eventId, title: '', currency: 'HTG', status: null },
    orders: Array.isArray(res?.orders) ? res.orders : [],
  };
  ordersCache.set(eventId, safe);
  return safe;
}

export async function fetchEventAnalytics(eventId: string): Promise<EventAnalyticsResponse> {
  return backendJson<EventAnalyticsResponse>(`/api/organizer/events/${encodeURIComponent(eventId)}/analytics`);
}

export async function resendTickets(ticketIds: string[]): Promise<{ sent: number }> {
  return backendJson<{ sent: number }>('/api/resend-ticket', {
    method: 'POST',
    body: JSON.stringify({ ticketIds }),
  });
}

export async function refundTickets(ticketIds: string[]): Promise<RefundResult> {
  return backendJson<RefundResult>('/api/refund-ticket', {
    method: 'POST',
    body: JSON.stringify({ ticketIds }),
  });
}

/** Lowercased haystack for the order search: buyer name, email, order and ticket ids. */
export function orderSearchText(o: EventOrder): string {
  return [o.buyer.name, o.buyer.email, o.id, ...o.tickets.map((t) => t.id)].join(' ').toLowerCase();
}
