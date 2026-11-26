/**
 * ADD-ONS in the app: paid extras sold alongside tickets (an iftar meal, a
 * T-shirt in S/M/L, parking, a book, raffle entries).
 *
 * A copy of the pure helpers in the web's lib/addons/addOns.ts, because the
 * Expo bundle cannot import root lib/. __tests__/mobile-addons-parity.test.ts
 * proves the two agree; if it fails, reconcile this file with the web one
 * (the web file is the source of truth). The server always re-prices and
 * re-validates: nothing here decides what a buyer is charged.
 */

export const MAX_ADD_ONS_PER_EVENT = 20;
export const MAX_ADD_ON_OPTIONS = 12;
export const MAX_ADD_ON_QTY_PER_ORDER = 20;
export const DEFAULT_ADD_ON_MAX_PER_ORDER = 10;
export const ADD_ON_NAME_MAX = 60;
export const ADD_ON_DESCRIPTION_MAX = 240;
export const ADD_ON_OPTION_MAX = 30;
export const ADD_ON_ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export interface EventAddOn {
  id: string;
  name: string;
  price: number;
  description?: string | null;
  image_url?: string | null;
  quantity?: number | null;
  options?: string[];
  max_per_order?: number | null;
  sales_start?: string | null;
  sales_end?: string | null;
  tier_ids?: string[];
  is_active?: boolean;
}

/** What the buyer picked (sent to create-payment-intent as `addOns`). */
export interface AddOnSelection {
  id: string;
  option: string | null;
  quantity: number;
  /** Display only: the stored price as the app read it. The server re-prices. */
  name: string;
  unitPrice: number;
}

export interface PurchasedAddOn {
  id: string;
  name: string;
  option: string | null;
  quantity: number;
  unit_price: number;
  face_total: number;
  charged_amount: number;
  buyer_fee: number;
  picked_up_at?: string | null;
  picked_up_by?: string | null;
}

const str = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

const posInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function httpsOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function newAddOnId(): string {
  return `ao_${Math.random().toString(36).slice(2, 10)}`;
}

/** Clean the organizer's list before it is saved (same rules as the web). */
export function normalizeAddOns(raw: unknown): EventAddOn[] {
  if (!Array.isArray(raw)) return [];
  const out: EventAddOn[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, any>;
    const name = str(a.name, ADD_ON_NAME_MAX);
    const price = money(a.price);
    if (!name || price <= 0) continue;
    let id = String(a.id || '').trim();
    if (!ADD_ON_ID_PATTERN.test(id) || seen.has(id)) id = newAddOnId();
    seen.add(id);
    const options: string[] = [];
    if (Array.isArray(a.options)) {
      for (const o of a.options) {
        const label = str(o, ADD_ON_OPTION_MAX);
        if (label && !options.some((x) => x.toLowerCase() === label.toLowerCase())) options.push(label);
        if (options.length >= MAX_ADD_ON_OPTIONS) break;
      }
    }
    const tierIds = Array.isArray(a.tier_ids)
      ? (Array.from(new Set(a.tier_ids.map((t: unknown) => String(t || '').trim()).filter(Boolean))).slice(0, 50) as string[])
      : [];
    const maxPer = posInt(a.max_per_order);
    out.push({
      id,
      name,
      price,
      description: str(a.description, ADD_ON_DESCRIPTION_MAX) || null,
      image_url: httpsOrNull(a.image_url),
      quantity: posInt(a.quantity),
      options,
      max_per_order: maxPer ? Math.min(maxPer, MAX_ADD_ON_QTY_PER_ORDER) : null,
      sales_start: isoOrNull(a.sales_start),
      sales_end: isoOrNull(a.sales_end),
      tier_ids: tierIds,
      is_active: a.is_active !== false,
    });
    if (out.length >= MAX_ADD_ONS_PER_EVENT) break;
  }
  return out;
}

/** The event's stored add-ons, read defensively (stored ids are never re-minted). */
export function eventAddOns(event: { add_ons?: unknown } | null | undefined): EventAddOn[] {
  const raw = event?.add_ons;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EventAddOn[] = [];
  for (const a of raw as any[]) {
    const id = String(a?.id || '');
    if (!a || typeof a !== 'object' || !ADD_ON_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const [clean] = normalizeAddOns([a]);
    if (clean) out.push({ ...clean, id });
  }
  return out;
}

export function addOnOrderLimit(addOn: EventAddOn): number {
  const own = posInt(addOn.max_per_order) ?? DEFAULT_ADD_ON_MAX_PER_ORDER;
  return Math.min(own, MAX_ADD_ON_QTY_PER_ORDER);
}

export function addOnRemaining(addOn: EventAddOn, soldMap: Record<string, unknown> | null | undefined): number | null {
  const cap = posInt(addOn.quantity);
  if (cap == null) return null;
  const sold = Math.max(0, Math.floor(Number(soldMap?.[addOn.id]) || 0));
  return Math.max(0, cap - sold);
}

export type AddOnAvailability = 'available' | 'inactive' | 'not_started' | 'ended' | 'sold_out' | 'needs_tier';

/** Hours an event without a stored end is assumed to run. */
export const ADD_ON_DEFAULT_EVENT_HOURS = 4;

/** A stored instant (ISO string, Date, Firestore Timestamp, {seconds}) as a Date, or null. */
function instantOf(v: any): Date | null {
  if (v == null || v === '') return null;
  let ms = NaN;
  if (typeof v?.toDate === 'function') ms = v.toDate().getTime();
  else if (v instanceof Date) ms = v.getTime();
  else if (typeof v?.seconds === 'number') ms = v.seconds * 1000;
  else if (typeof v?._seconds === 'number') ms = v._seconds * 1000;
  else if (typeof v === 'string' || typeof v === 'number') ms = new Date(v).getTime();
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * When an add-on stops selling: its own sales end, else the event's end (an
 * unset end means "until the event ends"); an event with no stored end is
 * assumed to end ADD_ON_DEFAULT_EVENT_HOURS after it starts. Null = no end known.
 */
export function addOnSalesEnd(addOn: EventAddOn, event?: { start?: unknown; end?: unknown } | null): Date | null {
  const own = instantOf(addOn.sales_end);
  if (own) return own;
  const end = instantOf(event?.end);
  if (end) return end;
  const start = instantOf(event?.start);
  return start ? new Date(start.getTime() + ADD_ON_DEFAULT_EVENT_HOURS * 3_600_000) : null;
}

export function addOnAvailability(
  addOn: EventAddOn,
  ctx: {
    now?: Date;
    cartTierIds?: string[];
    soldMap?: Record<string, unknown> | null;
    /** The event's start and end: an add-on with no sales end stops selling when the event ends. */
    eventStart?: unknown;
    eventEnd?: unknown;
  }
): AddOnAvailability {
  if (addOn.is_active === false) return 'inactive';
  const now = ctx.now || new Date();
  const start = addOn.sales_start ? new Date(addOn.sales_start) : null;
  const end = addOnSalesEnd(addOn, { start: ctx.eventStart, end: ctx.eventEnd });
  if (start && !Number.isNaN(start.getTime()) && start > now) return 'not_started';
  if (end && end < now) return 'ended';
  const remaining = addOnRemaining(addOn, ctx.soldMap);
  if (remaining !== null && remaining <= 0) return 'sold_out';
  const restricted = (addOn.tier_ids || []).filter(Boolean);
  if (restricted.length > 0) {
    const cart = new Set((ctx.cartTierIds || []).map(String));
    if (!restricted.some((t) => cart.has(t))) return 'needs_tier';
  }
  return 'available';
}

/** Face total (major units), one rounding per line, on integer cents. */
export function addOnSubtotal(lines: Array<{ unitPrice: number; quantity: number }>): number {
  const cents = (lines || []).reduce(
    (sum, l) =>
      sum + Math.round(Math.max(0, Number(l.unitPrice) || 0) * Math.max(0, Math.trunc(Number(l.quantity) || 0)) * 100),
    0
  );
  return cents / 100;
}

export function ticketAddOns(ticket: Record<string, any> | null | undefined): PurchasedAddOn[] {
  const raw = ticket?.add_ons;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a === 'object' && Number(a.quantity) > 0)
    .map((a: any) => ({
      id: String(a.id || ''),
      name: String(a.name || 'Add-on'),
      option: a.option ? String(a.option) : null,
      quantity: Math.floor(Number(a.quantity) || 0),
      unit_price: Number(a.unit_price) || 0,
      face_total: Number(a.face_total) || 0,
      charged_amount: Number(a.charged_amount) || 0,
      buyer_fee: Number(a.buyer_fee) || 0,
      picked_up_at: a.picked_up_at || null,
      picked_up_by: a.picked_up_by || null,
    }));
}

export function addOnLabel(a: { name: string; option?: string | null; quantity: number }): string {
  const option = a.option ? ` (${a.option})` : '';
  return `${a.name}${option} × ${a.quantity}`;
}

/** Options typed as "S, M, L" in the composer. */
export function parseOptionList(text: string): string[] {
  return String(text || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Quick starts for the add-on editor: what Haitian organizers sell most with a
 * ticket. Each only prefills a new add-on (name, and sizes for merch); the
 * editor shows the translated `addOns.presets.<key>`. Same list as the web's
 * lib/addons/presets.ts (parity-tested).
 */
export const ADD_ON_PRESETS = {
  bottle: { name: 'Bottle package', options: [] as string[] },
  table: { name: 'Table', options: [] as string[] },
  vip: { name: 'VIP upgrade', options: [] as string[] },
  parking: { name: 'Parking', options: [] as string[] },
  drinks: { name: 'Drink tickets', options: [] as string[] },
  merch: { name: 'T-shirt', options: ['S', 'M', 'L', 'XL'] },
} as const;

export type AddOnPresetKey = keyof typeof ADD_ON_PRESETS;
