/**
 * ADD-ONS: paid extras sold alongside tickets (an iftar meal, a T-shirt in
 * S/M/L, parking, a book, raffle entries).
 *
 * WHERE THEY LIVE
 * ---------------
 *   events/{id}.add_ons          EventAddOn[], written by the organizer with
 *                                the event (the same client write the composers
 *                                already make; firestore.rules guards it)
 *   events/{id}.add_ons_enabled  true when add_ons is non-empty. An event with
 *                                add-ons takes money, so it follows the paid
 *                                gates (publish gate, payout requirement,
 *                                listing-only countries, P0-6 paid-gate route)
 *   events/{id}.add_ons_sold     { [addOnId]: n } display rollup of the shards
 *                                (server only, like tickets_sold)
 *
 * Stock is reserved exactly like ticket tiers: a bucket `a_{addOnId}` in the
 * event's inventory shards (lib/tickets/inventoryShards.ts), held when checkout
 * starts and converted when the order is paid, in the same transaction as the
 * seats. Prices always come from the STORED add-on, never from the client.
 *
 * WHAT A BUYER GETS
 * -----------------
 * The purchased add-ons ride on the order's FIRST ticket (`add_ons` on that
 * ticket doc; the others carry `add_ons_ticket_id` pointing at it). The first
 * ticket's `charged_amount` includes what the add-ons cost, so the existing
 * per-ticket refund flow returns them with it, and refunding the whole order
 * covers everything.
 *
 * Pure and dependency-free: imported by the web composer, checkout surfaces,
 * the payment route and fulfillment. The Expo app keeps a copy in
 * mobile/lib/addOns.ts (parity-tested).
 */

export const MAX_ADD_ONS_PER_EVENT = 20
export const MAX_ADD_ON_OPTIONS = 12
/** Distinct add-on lines (add-on + option) in one order. */
export const MAX_ADD_ON_LINES_PER_ORDER = 10
/** Ceiling on one add-on's quantity in one order, whatever the organizer set. */
export const MAX_ADD_ON_QTY_PER_ORDER = 20
export const DEFAULT_ADD_ON_MAX_PER_ORDER = 10
export const ADD_ON_NAME_MAX = 60
export const ADD_ON_DESCRIPTION_MAX = 240
export const ADD_ON_OPTION_MAX = 30
/** Metadata key the add-on lines ride under on the PaymentIntent. */
export const ADD_ON_LINES_METADATA_KEY = 'ao'
const METADATA_VALUE_MAX = 500

export const ADD_ON_ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/

export interface EventAddOn {
  id: string
  name: string
  /** Face price of ONE unit, major units, event currency. Always > 0. */
  price: number
  description?: string | null
  image_url?: string | null
  /** Total stock across every option. null / 0 = unlimited. */
  quantity?: number | null
  /** Variants the buyer picks one of (sizes). Empty = no choice. */
  options?: string[]
  /** Most one order may buy of this add-on (all options together). */
  max_per_order?: number | null
  /** ISO instants; null = open. */
  sales_start?: string | null
  sales_end?: string | null
  /** Sold only with a ticket of one of these tiers. Empty = any ticket. */
  tier_ids?: string[]
  is_active?: boolean
}

/** What a buyer asks for (client input, never trusted for price). */
export interface AddOnSelection {
  id: string
  option?: string | null
  quantity: number
}

/** A validated, priced line: price from the stored add-on. */
export interface AddOnLine {
  addOnId: string
  name: string
  option: string | null
  quantity: number
  /** Stored unit price, major units, event currency. */
  unitPrice: number
}

/** What a purchased add-on looks like on the ticket. */
export interface PurchasedAddOn {
  id: string
  name: string
  option: string | null
  quantity: number
  unit_price: number
  /** Face total in the event currency (unit_price × quantity). */
  face_total: number
  /** What the card paid for this line, charged currency (face + its fee share). */
  charged_amount: number
  /** Buyer fee inside charged_amount (0 when the organizer absorbed it). */
  buyer_fee: number
  picked_up_at?: string | null
  picked_up_by?: string | null
}

const str = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const money = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

const posInt = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** An https URL only (photos are uploaded to Storage; anything else is dropped). */
function httpsOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** A short random id for a new add-on (client side). */
export function newAddOnId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `ao_${rand}`
}

/**
 * Clean an organizer's add-on list before it is saved. Drops unnamed or
 * unpriced entries, trims every field, de-duplicates options and ids, and
 * caps the list. Idempotent.
 */
export function normalizeAddOns(raw: unknown): EventAddOn[] {
  if (!Array.isArray(raw)) return []
  const out: EventAddOn[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, any>
    const name = str(a.name, ADD_ON_NAME_MAX)
    const price = money(a.price)
    if (!name || price <= 0) continue
    let id = String(a.id || '').trim()
    if (!ADD_ON_ID_PATTERN.test(id) || seen.has(id)) id = newAddOnId()
    seen.add(id)
    const options: string[] = []
    if (Array.isArray(a.options)) {
      for (const o of a.options) {
        const label = str(o, ADD_ON_OPTION_MAX)
        if (label && !options.some((x) => x.toLowerCase() === label.toLowerCase())) options.push(label)
        if (options.length >= MAX_ADD_ON_OPTIONS) break
      }
    }
    const tierIds = Array.isArray(a.tier_ids)
      ? Array.from(new Set(a.tier_ids.map((t: unknown) => String(t || '').trim()).filter(Boolean))).slice(0, 50) as string[]
      : []
    const maxPer = posInt(a.max_per_order)
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
    })
    if (out.length >= MAX_ADD_ONS_PER_EVENT) break
  }
  return out
}

/** The event's add-ons as stored, normalized for reading. */
export function eventAddOns(event: { add_ons?: unknown } | null | undefined): EventAddOn[] {
  return normalizeAddOnsForRead(event?.add_ons)
}

/** Like normalizeAddOns but never re-mints ids (a stored id is the stock key). */
function normalizeAddOnsForRead(raw: unknown): EventAddOn[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: EventAddOn[] = []
  for (const a of raw as any[]) {
    const id = String(a?.id || '')
    if (!a || typeof a !== 'object' || !ADD_ON_ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)
    const [clean] = normalizeAddOns([a])
    if (clean) out.push({ ...clean, id })
  }
  return out
}

/** True when the event sells at least one add-on (it then takes money). */
export function hasAddOns(event: { add_ons?: unknown } | null | undefined): boolean {
  return eventAddOns(event).length > 0
}

/** Units of this add-on one order may buy. */
export function addOnOrderLimit(addOn: EventAddOn): number {
  const own = posInt(addOn.max_per_order) ?? DEFAULT_ADD_ON_MAX_PER_ORDER
  return Math.min(own, MAX_ADD_ON_QTY_PER_ORDER)
}

/** Stock left from the display rollup (null = unlimited). Checkout re-checks in a transaction. */
export function addOnRemaining(addOn: EventAddOn, soldMap: Record<string, unknown> | null | undefined): number | null {
  const cap = posInt(addOn.quantity)
  if (cap == null) return null
  const sold = Math.max(0, Math.floor(Number(soldMap?.[addOn.id]) || 0))
  return Math.max(0, cap - sold)
}

export type AddOnAvailability = 'available' | 'inactive' | 'not_started' | 'ended' | 'sold_out' | 'needs_tier'

/** Hours an event without a stored end is assumed to run. */
export const ADD_ON_DEFAULT_EVENT_HOURS = 4

/** A stored instant (ISO string, Date, Firestore Timestamp, {seconds}) as a Date, or null. */
function instantOf(v: any): Date | null {
  if (v == null || v === '') return null
  let ms = NaN
  if (typeof v?.toDate === 'function') ms = v.toDate().getTime()
  else if (v instanceof Date) ms = v.getTime()
  else if (typeof v?.seconds === 'number') ms = v.seconds * 1000
  else if (typeof v?._seconds === 'number') ms = v._seconds * 1000
  else if (typeof v === 'string' || typeof v === 'number') ms = new Date(v).getTime()
  return Number.isFinite(ms) ? new Date(ms) : null
}

/**
 * When an add-on stops selling: its own sales end, else the event's end (an
 * unset end means "until the event ends"); an event with no stored end is
 * assumed to end ADD_ON_DEFAULT_EVENT_HOURS after it starts. Null = no end known.
 */
export function addOnSalesEnd(addOn: EventAddOn, event?: { start?: unknown; end?: unknown } | null): Date | null {
  const own = instantOf(addOn.sales_end)
  if (own) return own
  const end = instantOf(event?.end)
  if (end) return end
  const start = instantOf(event?.start)
  return start ? new Date(start.getTime() + ADD_ON_DEFAULT_EVENT_HOURS * 3_600_000) : null
}

/**
 * Whether a buyer may add this add-on right now, given the tiers in the cart.
 * `cartTierIds` empty with `cartHasTickets` true means a legacy single-price
 * event (no tiers): only an add-on restricted to no tier is offered then.
 */
export function addOnAvailability(
  addOn: EventAddOn,
  ctx: {
    now?: Date
    cartTierIds?: string[]
    soldMap?: Record<string, unknown> | null
    /** The event's start and end: an add-on with no sales end stops selling when the event ends. */
    eventStart?: unknown
    eventEnd?: unknown
  }
): AddOnAvailability {
  if (addOn.is_active === false) return 'inactive'
  const now = ctx.now || new Date()
  const start = addOn.sales_start ? new Date(addOn.sales_start) : null
  const end = addOnSalesEnd(addOn, { start: ctx.eventStart, end: ctx.eventEnd })
  if (start && !Number.isNaN(start.getTime()) && start > now) return 'not_started'
  if (end && end < now) return 'ended'
  const remaining = addOnRemaining(addOn, ctx.soldMap)
  if (remaining !== null && remaining <= 0) return 'sold_out'
  const restricted = (addOn.tier_ids || []).filter(Boolean)
  if (restricted.length > 0) {
    const cart = new Set((ctx.cartTierIds || []).map(String))
    if (!restricted.some((t) => cart.has(t))) return 'needs_tier'
  }
  return 'available'
}

export type AddOnRefusalCode =
  | 'addon_invalid'
  | 'addon_unavailable'
  | 'addon_not_started'
  | 'addon_ended'
  | 'addon_needs_tier'
  | 'addon_option_required'
  | 'addon_option_invalid'
  | 'addon_limit'
  | 'addon_sold_out'
  | 'addon_too_many_lines'

export type AddOnLinesResult =
  | { ok: true; lines: AddOnLine[] }
  | { ok: false; code: AddOnRefusalCode; error: string; addOnId?: string }

const refuse = (code: AddOnRefusalCode, error: string, addOnId?: string): AddOnLinesResult => ({
  ok: false,
  code,
  error,
  ...(addOnId ? { addOnId } : {}),
})

/**
 * SERVER: turn a buyer's raw selection into priced lines, from the event's
 * stored add-ons. Validates every rule except stock, which the inventory
 * transaction decides (a lock-free pre-check against the rollup is included
 * so a plainly sold-out add-on is refused before any hold).
 *
 * `ticketLines` are the order's ticket lines (tierId may be '' for a legacy
 * single-price event). An order always has at least one ticket: add-ons are
 * never sold on their own.
 */
export function resolveAddOnLines(
  event: { add_ons?: unknown; add_ons_sold?: unknown; start_datetime?: unknown; end_datetime?: unknown } | null | undefined,
  raw: unknown,
  ticketLines: Array<{ tierId?: string | null; quantity: number }>,
  now: Date = new Date()
): AddOnLinesResult {
  if (raw === undefined || raw === null) return { ok: true, lines: [] }
  if (!Array.isArray(raw)) return refuse('addon_invalid', 'Invalid add-on selection.')
  if (raw.length === 0) return { ok: true, lines: [] }
  const addOns = eventAddOns(event)
  const byId = new Map(addOns.map((a) => [a.id, a]))
  const cartTierIds = ticketLines.filter((l) => l.quantity > 0 && l.tierId).map((l) => String(l.tierId))
  const soldMap = (event?.add_ons_sold && typeof event.add_ons_sold === 'object' ? event.add_ons_sold : null) as
    | Record<string, unknown>
    | null

  // Merge (id, option) duplicates; keep first-seen order.
  const merged = new Map<string, { addOn: EventAddOn; option: string | null; quantity: number }>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return refuse('addon_invalid', 'Invalid add-on selection.')
    const id = String((entry as any).id ?? (entry as any).addOnId ?? '').trim()
    const qty = Number((entry as any).quantity)
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_ADD_ON_QTY_PER_ORDER) {
      return refuse('addon_invalid', 'Invalid add-on quantity.', id || undefined)
    }
    if (qty === 0) continue
    const addOn = byId.get(id)
    if (!addOn) return refuse('addon_unavailable', 'This add-on is no longer available.', id || undefined)
    const rawOption = (entry as any).option
    const option = rawOption === undefined || rawOption === null ? '' : String(rawOption).trim()
    const options = addOn.options || []
    let chosen: string | null = null
    if (options.length > 0) {
      if (!option) return refuse('addon_option_required', `Choose an option for "${addOn.name}".`, id)
      const match = options.find((o) => o.toLowerCase() === option.toLowerCase())
      if (!match) return refuse('addon_option_invalid', `That option is not available for "${addOn.name}".`, id)
      chosen = match
    } else if (option) {
      return refuse('addon_option_invalid', `"${addOn.name}" has no options to choose from.`, id)
    }
    const key = `${id}\u0000${chosen ?? ''}`
    const prior = merged.get(key)
    merged.set(key, { addOn, option: chosen, quantity: (prior?.quantity || 0) + qty })
  }
  if (merged.size === 0) return { ok: true, lines: [] }
  if (merged.size > MAX_ADD_ON_LINES_PER_ORDER) {
    return refuse('addon_too_many_lines', 'Too many different add-ons in one order.')
  }

  const perAddOn = new Map<string, number>()
  for (const { addOn, quantity } of merged.values()) perAddOn.set(addOn.id, (perAddOn.get(addOn.id) || 0) + quantity)

  for (const [id, total] of perAddOn) {
    const addOn = byId.get(id)!
    const availability = addOnAvailability(addOn, {
      now,
      cartTierIds,
      soldMap,
      eventStart: event?.start_datetime,
      eventEnd: event?.end_datetime,
    })
    if (availability === 'inactive') return refuse('addon_unavailable', `"${addOn.name}" is not available.`, id)
    if (availability === 'not_started') return refuse('addon_not_started', `"${addOn.name}" is not on sale yet.`, id)
    if (availability === 'ended') return refuse('addon_ended', `Sales of "${addOn.name}" have ended.`, id)
    if (availability === 'sold_out') return refuse('addon_sold_out', `"${addOn.name}" is sold out.`, id)
    if (availability === 'needs_tier') {
      return refuse('addon_needs_tier', `"${addOn.name}" is only sold with certain tickets.`, id)
    }
    const limit = addOnOrderLimit(addOn)
    if (total > limit) return refuse('addon_limit', `You can add at most ${limit} of "${addOn.name}" to one order.`, id)
    const remaining = addOnRemaining(addOn, soldMap)
    if (remaining !== null && total > remaining) {
      return refuse('addon_sold_out', `Only ${remaining} of "${addOn.name}" left.`, id)
    }
  }

  const lines: AddOnLine[] = Array.from(merged.values()).map(({ addOn, option, quantity }) => ({
    addOnId: addOn.id,
    name: addOn.name,
    option,
    quantity,
    unitPrice: addOn.price,
  }))
  return { ok: true, lines }
}

/** Per-add-on stock increments (options share one stock). */
export function addOnIncrements(lines: Array<{ addOnId: string; quantity: number }>): Array<{ addOnId: string; quantity: number }> {
  const merged = new Map<string, number>()
  for (const l of lines || []) {
    const q = Number(l?.quantity)
    if (!l?.addOnId || !Number.isInteger(q) || q <= 0) continue
    merged.set(String(l.addOnId), (merged.get(String(l.addOnId)) || 0) + q)
  }
  return Array.from(merged.entries()).map(([addOnId, quantity]) => ({ addOnId, quantity }))
}

/** Face total of the lines in the CHARGE currency's minor units (one rounding per line). */
export function addOnFaceCents(lines: Array<{ unitPrice: number; quantity: number }>, rate = 1): number {
  const r = Number(rate) > 0 ? Number(rate) : 1
  return (lines || []).reduce(
    (sum, l) => sum + Math.round(Math.max(0, Number(l.unitPrice) || 0) * r * Math.max(0, Math.trunc(Number(l.quantity) || 0)) * 100),
    0
  )
}

/** Face total in major units (event currency), for display. */
export function addOnSubtotal(lines: Array<{ unitPrice: number; quantity: number }>): number {
  return addOnFaceCents(lines) / 100
}

/**
 * The share of the order's buyer fee that belongs to the add-ons: in
 * proportion to their share of the face total, rounded down (the rounding
 * remainder stays with the tickets, as the ticket split already puts its
 * remainder on the last paid ticket).
 */
export function addOnFeeShareCents(params: { buyerFeeCents: number; faceValueCents: number; addOnFaceCents: number }): number {
  const fee = Math.max(0, Math.round(Number(params.buyerFeeCents) || 0))
  const face = Math.max(0, Math.round(Number(params.faceValueCents) || 0))
  const ao = Math.max(0, Math.min(face, Math.round(Number(params.addOnFaceCents) || 0)))
  if (fee === 0 || face === 0 || ao === 0) return 0
  if (ao === face) return fee
  return Math.floor((fee * ao) / face)
}

// ── PaymentIntent metadata ─────────────────────────────────────────────────

/** Encode the lines as compact JSON `[[id, option, qty, unitPrice], …]`, or null when it will not fit. */
export function encodeAddOnLines(lines: AddOnLine[]): string | null {
  const json = JSON.stringify(
    lines.map((l) => [l.addOnId, l.option ?? '', l.quantity, Math.round(l.unitPrice * 100) / 100])
  )
  return json.length <= METADATA_VALUE_MAX ? json : null
}

export type DecodedAddOnLines =
  | { present: false }
  | { present: true; ok: true; lines: Array<Omit<AddOnLine, 'name'>> }
  | { present: true; ok: false }

export function decodeAddOnLines(metadata: Record<string, any> | null | undefined): DecodedAddOnLines {
  const raw = metadata?.[ADD_ON_LINES_METADATA_KEY]
  if (raw === undefined || raw === null || raw === '') return { present: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    return { present: true, ok: false }
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_ADD_ON_LINES_PER_ORDER) {
    return { present: true, ok: false }
  }
  const lines: Array<Omit<AddOnLine, 'name'>> = []
  for (const entry of parsed) {
    if (!Array.isArray(entry)) return { present: true, ok: false }
    const [id, option, qty, unit] = entry
    const quantity = Number(qty)
    const unitPrice = Number(unit)
    if (typeof id !== 'string' || !ADD_ON_ID_PATTERN.test(id)) return { present: true, ok: false }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_ADD_ON_QTY_PER_ORDER) return { present: true, ok: false }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { present: true, ok: false }
    lines.push({ addOnId: id, option: option ? String(option) : null, quantity, unitPrice })
  }
  return { present: true, ok: true, lines }
}

/**
 * The add-ons as written on the order's first ticket. Each line's charged
 * amount is its face (in the charge currency) plus its share of the add-on
 * fee, split by face with the remainder on the last line, so the lines add up
 * to exactly what the card paid for the add-ons.
 */
export function purchasedAddOnsFor(
  lines: Array<{ addOnId: string; name?: string | null; option: string | null; quantity: number; unitPrice: number }>,
  opts: { chargeRate?: number; addOnFeeCents: number; names?: Record<string, string> }
): PurchasedAddOn[] {
  const rate = Number(opts.chargeRate) > 0 ? Number(opts.chargeRate) : 1
  const faces = lines.map((l) => Math.round(l.unitPrice * rate * l.quantity * 100))
  const totalFace = faces.reduce((a, b) => a + b, 0)
  const fee = Math.max(0, Math.round(opts.addOnFeeCents || 0))
  let allocated = 0
  return lines.map((l, i) => {
    let share = 0
    if (fee > 0 && totalFace > 0) {
      share = i === lines.length - 1 ? fee - allocated : Math.floor((fee * faces[i]) / totalFace)
      allocated += share
    }
    return {
      id: l.addOnId,
      name: String(l.name || opts.names?.[l.addOnId] || 'Add-on'),
      option: l.option || null,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      face_total: Math.round(l.unitPrice * l.quantity * 100) / 100,
      charged_amount: (faces[i] + share) / 100,
      buyer_fee: share / 100,
      picked_up_at: null,
      picked_up_by: null,
    }
  })
}

/** Purchased add-ons on a ticket doc (empty when none). */
export function ticketAddOns(ticket: Record<string, any> | null | undefined): PurchasedAddOn[] {
  const raw = ticket?.add_ons
  if (!Array.isArray(raw)) return []
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
    }))
}

/** "T-shirt (M) × 2" — one line of a receipt or a door row. */
export function addOnLabel(a: { name: string; option?: string | null; quantity: number }): string {
  const option = a.option ? ` (${a.option})` : ''
  return `${a.name}${option} × ${a.quantity}`
}

// ── Organizer summary ────────────────────────────────────────────────────────

export interface AddOnSalesRow {
  id: string
  name: string
  option: string | null
  sold: number
  pickedUp: number
  /** Face revenue, event currency (refunded tickets excluded). */
  revenue: number
}

export interface AddOnSalesSummary {
  rows: AddOnSalesRow[]
  totalSold: number
  totalPickedUp: number
  totalRevenue: number
}

/**
 * Add-on sales from the event's tickets: one row per add-on + option, counting
 * only live tickets (a refunded lead ticket gave its add-ons back).
 */
export function summarizeAddOnSales(
  tickets: Array<Record<string, any>>,
  isLive: (ticket: Record<string, any>) => boolean
): AddOnSalesSummary {
  const rows = new Map<string, AddOnSalesRow>()
  for (const t of tickets || []) {
    const addOns = ticketAddOns(t)
    if (addOns.length === 0 || !isLive(t)) continue
    for (const a of addOns) {
      const key = `${a.id}\u0000${a.option ?? ''}`
      const row = rows.get(key) || { id: a.id, name: a.name, option: a.option, sold: 0, pickedUp: 0, revenue: 0 }
      row.sold += a.quantity
      if (a.picked_up_at) row.pickedUp += a.quantity
      row.revenue = Math.round((row.revenue + a.face_total) * 100) / 100
      rows.set(key, row)
    }
  }
  const list = Array.from(rows.values()).sort((x, y) => x.name.localeCompare(y.name) || String(x.option).localeCompare(String(y.option)))
  return {
    rows: list,
    totalSold: list.reduce((s, r) => s + r.sold, 0),
    totalPickedUp: list.reduce((s, r) => s + r.pickedUp, 0),
    totalRevenue: Math.round(list.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
  }
}

/**
 * The add-ons' FACE value booked on a ticket (event currency, major units): 0
 * on every ticket but an order's first one. The payout engine, the refund face
 * and the earnings view add it to `price_paid`, so add-on money is earned,
 * refunded and withdrawn exactly like the ticket that carries it.
 */
export function ticketAddOnFace(ticket: Record<string, any> | null | undefined): number {
  if (!Array.isArray(ticket?.add_ons) && ticket?.add_ons_face_total == null) return 0
  const n = Number(ticket?.add_ons_face_total)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}
