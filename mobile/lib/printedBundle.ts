/**
 * Printed (physical) tickets counted WITH the online ones in the organizer's
 * event views (owner 2026-11-24: "bundled, not a separate world").
 *
 *   VIP · 132 online + 88 printed · 220 / 300 sold · 40 printed, not sold yet
 *
 * Rules (lib/physical on the web):
 *  - A printed ticket is SOLD once activated (status valid, holder named at a
 *    point of sale). It counts in sold and check-in like any ticket, but its
 *    price_paid is 0: never revenue.
 *  - An unsold printed ticket (printed_unsold, or voided before its seat came
 *    back) is a RESERVED seat: the event's tickets_sold already counts it (the
 *    batch reserves its seats on order), so sold for people = tickets_sold −
 *    held seats. It is never an attendee, an order or a sale.
 *  - A batch awaiting payment holds its whole quantity before any ticket
 *    exists; the batches endpoint reports that as heldSeats.
 *
 * Pure: no React, Expo or Firebase imports, so root Jest tests import it
 * (__tests__/mobile-printed-bundle.test.ts).
 */

export type TicketDoc = Record<string, any>;

/** One batch as GET /api/organizer/events/{id}/physical-batches returns it. */
export interface PrintedBatchSummary {
  batch: {
    id: string;
    tier_id?: string;
    tier_name?: string;
    quantity?: number;
    status?: string;
    serial_prefix?: string;
    [k: string]: any;
  };
  counts: {
    printed: number;
    unsold: number;
    activated: number;
    checkedIn: number;
    voided: number;
    released: number;
    held?: number;
  };
  /** Older servers omit it; see batchHeld. */
  heldSeats?: number;
}

export interface TierBundle {
  name: string;
  /** Online sold + printed sold. */
  sold: number;
  online: number;
  printedSold: number;
  /** Printed seats reserved for this tier that nobody has bought yet. */
  printedUnsold: number;
  capacity: number;
}

export interface BundledBreakdown {
  ticketsSold: number;
  ticketsCheckedIn: number;
  capacity: number;
  printed: { sold: number; checkedIn: number; unsold: number };
  ticketTypes: TierBundle[];
}

const UNSOLD_PRINTED = ['printed_unsold', 'voided', 'released'];

/**
 * The printed design's name in the reader's language ("Carton coloré"), from
 * the name the server stored on the batch (design.template_name); null for a
 * batch ordered before the design gallery. Ordering stays on the web.
 */
export function batchDesignName(batch: PrintedBatchSummary['batch'] | null | undefined, language: string): string | null {
  const names = batch?.design?.template_name;
  if (!names || typeof names !== 'object') return null;
  const lang = String(language || '').slice(0, 2);
  const name = names[lang] || names.en || names.fr;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** A printed (physical) ticket doc, whatever its state. */
export function isPrintedTicket(t: TicketDoc | null | undefined): boolean {
  return !!t && (t.kind === 'physical' || t.source === 'physical' || !!t.physical_batch_id);
}

/** A printed ticket nobody bought (unsold, voided or released): not an attendee. */
export function isUnsoldPrintedTicket(t: TicketDoc | null | undefined): boolean {
  if (!t) return false;
  const s = String(t.status ?? '');
  // 'printed_unsold' exists only on printed tickets (a slimmed cached row may lack `kind`).
  return s === 'printed_unsold' || (isPrintedTicket(t) && UNSOLD_PRINTED.includes(s));
}

/** Does this ticket doc belong on the attendee list? Everything except unsold printed tickets. */
export function isAttendeeTicket(t: TicketDoc | null | undefined): boolean {
  return !!t && !isUnsoldPrintedTicket(t);
}

/** "FETE-VIP-B1-0012" for a printed ticket, '' otherwise. */
export function printedSerialOf(t: TicketDoc | null | undefined): string {
  return isPrintedTicket(t) ? String(t!.physical_serial || '') : '';
}

/** Live = valid | confirmed | active, a legacy doc with no status, or the old 'checked_in'. */
export function isLiveTicket(t: TicketDoc): boolean {
  const s = String(t?.status ?? '').trim().toLowerCase();
  return s === '' || s === 'valid' || s === 'confirmed' || s === 'active' || s === 'checked_in';
}

export function isCheckedInTicket(t: TicketDoc): boolean {
  return !!t?.checked_in_at || t?.checked_in === true || String(t?.status ?? '').toLowerCase() === 'checked_in';
}

/** A printed ticket whose seat is still reserved without a buyer. */
function holdsSeat(t: TicketDoc): boolean {
  const s = String(t?.status ?? '');
  return isPrintedTicket(t) && (s === 'printed_unsold' || s === 'voided') && !t.seat_returned_at;
}

/**
 * Tickets sold to people, off the event doc alone: tickets_sold counts every
 * seat a printed batch reserved, and the server keeps physical_held_seats
 * (lib/physical/rules.soldForPeople, same rule) for the unsold ones.
 */
export function soldForPeople(event: { tickets_sold?: unknown; physical_held_seats?: unknown } | null | undefined): number {
  const sold = Math.max(0, Math.round(Number(event?.tickets_sold) || 0));
  const held = Math.max(0, Math.round(Number(event?.physical_held_seats) || 0));
  return Math.max(0, sold - held);
}

/** Seats held by unsold printed tickets among these docs (no batch data: misses batches awaiting payment). */
export function heldSeatsFromTickets(tickets: TicketDoc[]): number {
  return tickets.filter(holdsSeat).length;
}

/** Seats one batch holds without a buyer (the server's heldSeats, or the same rule from its counts). */
export function batchHeld(b: PrintedBatchSummary): number {
  if (typeof b.heldSeats === 'number' && Number.isFinite(b.heldSeats)) return Math.max(0, b.heldSeats);
  if (String(b.batch?.status || '') === 'cancelled') return 0;
  const quantity = Math.max(0, Math.round(Number(b.batch?.quantity) || 0));
  const held = typeof b.counts?.held === 'number' ? b.counts.held : Number(b.counts?.unsold || 0);
  return Math.max(0, held) + Math.max(0, quantity - Math.max(0, Number(b.counts?.printed || 0)));
}

const tierLabel = (t: TicketDoc): string => String(t.tier_name || t.ticket_tier_name || 'General Admission');

/**
 * The event's numbers with printed tickets folded in.
 *
 * @param ticketsSold the event doc's tickets_sold (counts every reserved printed seat)
 * @param batches     the batches endpoint's list, or null when it could not be
 *                    read (a role without it): the held seats then come from
 *                    the ticket docs alone.
 */
export function bundleBreakdown(input: {
  ticketsSold: number;
  capacity: number;
  tickets: TicketDoc[];
  tiers: Array<{ id?: string; name?: string; total_quantity?: number; quantity?: number }>;
  batches?: PrintedBatchSummary[] | null;
}): BundledBreakdown {
  const tierMap = new Map<string, TierBundle>();
  const tierNameById = new Map<string, string>();
  for (const tier of input.tiers) {
    const name = String(tier.name || '');
    if (!name) continue;
    if (tier.id) tierNameById.set(String(tier.id), name);
    tierMap.set(name, {
      name,
      sold: 0,
      online: 0,
      printedSold: 0,
      printedUnsold: 0,
      capacity: Number(tier.total_quantity ?? tier.quantity ?? 0) || 0,
    });
  }
  const tierFor = (name: string): TierBundle => {
    let tier = tierMap.get(name);
    if (!tier) {
      // A ticket whose tier is gone: its own row, no known cap.
      tier = { name, sold: 0, online: 0, printedSold: 0, printedUnsold: 0, capacity: 0 };
      tierMap.set(name, tier);
    }
    return tier;
  };

  let checkedIn = 0;
  let printedSold = 0;
  let printedCheckedIn = 0;
  let heldFromTickets = 0;
  for (const t of input.tickets) {
    if (isCheckedInTicket(t) && !isUnsoldPrintedTicket(t)) checkedIn++;
    if (isPrintedTicket(t)) {
      if (holdsSeat(t)) {
        heldFromTickets++;
        if (!input.batches) tierFor(tierLabel(t)).printedUnsold++;
      }
      if (isUnsoldPrintedTicket(t) || !isLiveTicket(t)) continue;
      printedSold++;
      if (isCheckedInTicket(t)) printedCheckedIn++;
      tierFor(tierLabel(t)).printedSold++;
      continue;
    }
    if (!isLiveTicket(t)) continue;
    tierFor(tierLabel(t)).online++;
  }

  let held = heldFromTickets;
  if (input.batches) {
    held = 0;
    for (const b of input.batches) {
      const n = batchHeld(b);
      if (n <= 0) continue;
      held += n;
      const name = tierNameById.get(String(b.batch?.tier_id || '')) || String(b.batch?.tier_name || '');
      if (name) tierFor(name).printedUnsold += n;
    }
  }

  const ticketTypes = Array.from(tierMap.values()).map((tier) => ({ ...tier, sold: tier.online + tier.printedSold }));
  return {
    ticketsSold: Math.max(0, (Number(input.ticketsSold) || 0) - held),
    ticketsCheckedIn: checkedIn,
    capacity: Number(input.capacity) || 0,
    printed: { sold: printedSold, checkedIn: printedCheckedIn, unsold: held },
    ticketTypes,
  };
}

// ── the batches list on the event screen ─────────────────────────────────────

export type BatchTone = 'live' | 'pending' | 'neutral';

/** A batch's state for a dot + label (no pills): the locale key under printedBundle.batchStatus and its tone. */
export function batchState(status: unknown): { key: string; tone: BatchTone } {
  switch (String(status || '')) {
    case 'awaiting_payment':
      return { key: 'awaitingPayment', tone: 'pending' };
    case 'paid':
    case 'printing':
      return { key: 'printing', tone: 'pending' };
    case 'ready':
      return { key: 'ready', tone: 'live' };
    case 'active':
      return { key: 'selling', tone: 'live' };
    case 'cancelled':
      return { key: 'cancelled', tone: 'neutral' };
    default:
      return { key: 'printing', tone: 'neutral' };
  }
}

/** Batches worth listing: everything but cancelled ones, newest first as the server sends them. */
export function visibleBatches(batches: PrintedBatchSummary[] | null | undefined): PrintedBatchSummary[] {
  return (batches || []).filter((b) => String(b.batch?.status || '') !== 'cancelled');
}

/** Can tickets of these batches be sold now (any batch ready or selling)? */
export function hasSellableBatch(batches: PrintedBatchSummary[] | null | undefined): boolean {
  return (batches || []).some((b) => ['ready', 'active', 'printing'].includes(String(b.batch?.status || '')));
}

/** The web page where batches are ordered and managed. */
export function printedManageUrl(eventId: string, origin = 'https://www.tikem.co'): string {
  return `${origin.replace(/\/$/, '')}/organizer/events/${encodeURIComponent(eventId)}/printed`;
}
