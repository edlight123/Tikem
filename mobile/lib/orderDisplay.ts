import { formatCurrency } from './currency';
import type { EventOrder, MoneyLine, OrderStatus } from './api/eventOrders';

/**
 * Display helpers shared by the organizer Orders list, Order detail and the
 * refund sheet. Money is always rendered per currency and joined with " + " —
 * an HTG figure and a USD figure are never added together.
 */

const LIVE = new Set(['valid', 'confirmed', 'active', '', 'checked_in']);

/** A ticket counts when its status is live (valid / confirmed / active). */
export function isLiveTicket(status: string | null | undefined): boolean {
  return LIVE.has(String(status ?? '').toLowerCase().trim());
}

export function formatMoneyLines(lines: MoneyLine[]): string {
  return lines.map((l) => formatCurrency(l.amount, l.currency)).join(' + ');
}

/** Revenue of the still-live tickets in these orders, per currency, largest first. */
export function liveRevenue(orders: EventOrder[]): MoneyLine[] {
  const totals = new Map<string, number>();
  for (const o of orders) {
    for (const t of o.tickets) {
      if (!isLiveTicket(t.status) || !(t.pricePaid > 0)) continue;
      totals.set(t.currency, (totals.get(t.currency) || 0) + t.pricePaid);
    }
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
}

/** i18n key under `organizerOrders.method.*`. */
export function methodKey(method: string): string {
  const m = String(method || '').toLowerCase();
  if (m === 'stripe' || m === 'stripe_connect' || m === 'card') return 'card';
  if (m === 'moncash' || m === 'natcash' || m === 'sogepay' || m === 'free' || m === 'comp') return m;
  return 'other';
}

/**
 * StatusChip tone for an order (POSH §2.7 locked map): a paid order is a
 * success (emerald), an in-flight refund needs attention (amber), and a
 * refunded / cancelled order is history (grey) — not an error.
 */
export function orderTone(status: OrderStatus): string {
  switch (status) {
    case 'paid':
    case 'free':
      return 'success';
    case 'refund_pending':
    case 'partially_refunded':
      return 'pending';
    default:
      return 'neutral';
  }
}
