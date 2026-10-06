/**
 * Ticket identity helpers — one source of truth for how a ticket presents
 * itself (order ref, tier label, lifecycle status). Both the post-purchase
 * pass card and the ticket-detail screen consume these so there is ONE ticket
 * identity across the app.
 */

/**
 * Short, human order reference. Prefers a real order number, then falls back to
 * a stub derived from the ticket id. The Tikèm prefix is `TKM-` (never the
 * legacy `EH-`).
 */
export function ticketOrderRef(ticket: any): string {
  const raw =
    ticket?.order_number ||
    ticket?.order_id ||
    ticket?.orderId ||
    ticket?.id ||
    '';
  const short = String(raw).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `TKM-${short || 'XXXXXXXX'}`;
}

/** The real tier name (e.g. "VIP", "Early Bird"), never a hardcoded default. */
export function ticketTierLabel(ticket: any): string | undefined {
  const tier = ticket?.tier_name || ticket?.ticket_type || ticket?.tierName;
  const cleaned = tier ? String(tier).trim() : '';
  return cleaned || undefined;
}

/**
 * The value encoded into the QR: the ticket's current code when present, else
 * the id. After a transfer the server writes a signed payload to BOTH qr_code
 * and qr_code_data (lib/tickets/qr.ts) and the bare id stops admitting.
 */
export function ticketQrValue(ticket: any, fallbackId?: string): string {
  return String(ticket?.qr_code || ticket?.qr_code_data || ticket?.id || fallbackId || 'no-ticket-id');
}

/**
 * Lifecycle status key for `StatusChip` — driven by ticket STATE first, then
 * event date. Maps into the locked semantic color set:
 *   used / checked-in / expired → grey   ·   active/upcoming → teal
 * (Amber is reserved for action-needed and is deliberately NOT used here.)
 */
export function ticketStatusKey(ticket: any, isExpired: boolean): string {
  if (ticket?.checked_in_at) return 'used';
  const raw = String(ticket?.status || '').toLowerCase();
  if (raw === 'used' || raw === 'checked_in') return 'used';
  if (isExpired) return 'expired';
  if (raw === 'confirmed' || raw === 'active' || raw === 'valid') return 'active';
  return raw || 'active';
}
