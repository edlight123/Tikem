/**
 * Ticket-tier reconciliation: turn "the tiers the organizer left in the editor"
 * into in-place writes against the existing `ticket_tiers` docs.
 *
 * Why this exists: both composers used to REPLACE the whole tier set on every
 * save (delete every doc for the event, insert fresh ones with
 * `sold_quantity: 0`). That reset every sold count, so checkout, which asks
 * `total_quantity - sold_quantity > 0`, would oversell an edited event. It also
 * gave the tiers new doc ids, leaving every ticket's `tier_id` pointing at a
 * deleted doc. The rules here:
 *
 *  - An editor row carrying the id of a live doc UPDATES that doc. The caller
 *    writes editable fields only, never `sold_quantity`, `created_at` or
 *    `event_id`.
 *  - An editor row without a (matching) id is INSERTED with `sold_quantity: 0`.
 *  - A live doc no longer in the editor is an orphan. If anything was sold
 *    against it, it is DEACTIVATED (`is_active: false`, `archived: true`) so it
 *    stops selling and history stays intact. If its counter says 0, the caller
 *    must first check for tickets referencing it (`tier_id`), because a reset
 *    counter is exactly what the old bug left behind. Only a tier with no
 *    tickets at all is deleted.
 *  - The quantity can never drop below what is already sold.
 *
 * Pure and dependency-free. The Expo app keeps a byte-for-byte copy at
 * mobile/lib/tierReconcile.ts (it cannot import web code), and
 * __tests__/tier-reconcile-parity.test.ts asserts the two agree.
 */

export interface ExistingTier {
  id: string
  name?: string | null
  sort_order?: number | null
  sold_quantity?: number | null
  /** Set when a reconcile deactivated the tier instead of deleting it. */
  archived?: boolean | null
}

export interface DesiredTier<F> {
  /** Doc id this editor row was loaded from; absent for a row added in this edit. */
  id?: string | null
  name: string
  /** Requested total quantity (the unlimited sentinel counts as a number). */
  quantity: number
  /** Editable fields the caller writes on update and insert. */
  fields: F
}

export interface TierUpdate<F> {
  id: string
  sortOrder: number
  fields: F
  /** The existing sold count. Never written; returned so callers can display it. */
  soldQuantity: number
  /** Requested quantity clamped to at least `soldQuantity`. */
  totalQuantity: number
  /** max(0, totalQuantity - soldQuantity), for docs that keep an `available` field. */
  available: number
}

export interface TierInsert<F> {
  sortOrder: number
  fields: F
  totalQuantity: number
}

export interface TierOrphan {
  id: string
  soldQuantity: number
  /**
   * 'deactivate': something was sold, keep the doc but stop it selling.
   * 'check_tickets': the counter says 0, so look for tickets with this
   * `tier_id` and pass the count to resolveOrphan().
   */
  action: 'deactivate' | 'check_tickets'
}

export interface TierSyncPlan<F> {
  updates: TierUpdate<F>[]
  inserts: TierInsert<F>[]
  orphans: TierOrphan[]
}

/** A doc's sold count as a safe non-negative integer. */
export function soldQuantityOf(tier: { sold_quantity?: unknown } | null | undefined): number {
  const n = Math.floor(Number(tier?.sold_quantity ?? 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The smallest total an organizer may set: what is already sold. */
export function clampTierQuantity(requested: number, soldQuantity: number): number {
  const req = Number.isFinite(requested) ? Math.floor(requested) : 0
  return Math.max(req, Math.max(0, Math.floor(soldQuantity || 0)))
}

/**
 * Inline-validation helper: true when a capped tier asks for fewer tickets
 * than have already been sold. Unlimited tiers never trip it.
 */
export function isQuantityBelowSold(
  requested: number,
  soldQuantity: number,
  unlimited = false
): boolean {
  if (unlimited) return false
  const sold = Math.max(0, Math.floor(soldQuantity || 0))
  if (sold <= 0) return false
  const req = Number.isFinite(requested) ? Math.floor(requested) : 0
  return req < sold
}

/** Archived docs were removed from the editor in an earlier save; they stay out of it. */
export function isLiveTier(tier: { archived?: unknown } | null | undefined): boolean {
  return tier?.archived !== true
}

/**
 * Decide what to do with a tier the organizer removed: deactivate when anything
 * was sold against it (by its counter or by tickets carrying its id), delete
 * only when it has no history at all.
 */
export function resolveOrphan(
  soldQuantity: number,
  referencingTickets: number
): 'delete' | 'deactivate' {
  return soldQuantity > 0 || referencingTickets > 0 ? 'deactivate' : 'delete'
}

/**
 * Plan the writes that bring `existing` (every doc with this event_id) in line
 * with `desired` (the editor rows, in display order). Archived docs are left
 * alone: they are neither matched nor treated as orphans.
 */
export function planTierSync<F>(
  existing: ExistingTier[],
  desired: DesiredTier<F>[]
): TierSyncPlan<F> {
  const live = existing.filter(isLiveTier)
  const byId = new Map<string, ExistingTier>()
  for (const t of live) if (t?.id) byId.set(String(t.id), t)

  const claimed = new Set<string>()
  const updates: TierUpdate<F>[] = []
  const inserts: TierInsert<F>[] = []

  desired.forEach((row, sortOrder) => {
    const id = row.id ? String(row.id) : ''
    const match = id && !claimed.has(id) ? byId.get(id) : undefined
    if (match) {
      claimed.add(id)
      const sold = soldQuantityOf(match)
      const totalQuantity = clampTierQuantity(row.quantity, sold)
      updates.push({
        id,
        sortOrder,
        fields: row.fields,
        soldQuantity: sold,
        totalQuantity,
        available: Math.max(0, totalQuantity - sold),
      })
    } else {
      inserts.push({ sortOrder, fields: row.fields, totalQuantity: clampTierQuantity(row.quantity, 0) })
    }
  })

  const orphans: TierOrphan[] = []
  for (const t of live) {
    if (!t?.id || claimed.has(String(t.id))) continue
    const sold = soldQuantityOf(t)
    orphans.push({ id: String(t.id), soldQuantity: sold, action: sold > 0 ? 'deactivate' : 'check_tickets' })
  }

  return { updates, inserts, orphans }
}

const normName = (s: unknown) => String(s ?? '').trim().toLowerCase()

/**
 * Series siblings each own their tier docs and sold counts. Map each editor
 * row (whose ids belong to the SOURCE event) onto the sibling's own tier ids:
 *
 *  1. a row loaded from a source doc matches the sibling tier with that source
 *     doc's ORIGINAL name (so a rename still lands on the right sibling tier),
 *  2. failing that, the sibling tier at the source doc's sort_order,
 *  3. any row still unmatched (including a newly added one) matches a sibling
 *     tier with the row's current name.
 *
 * Each sibling tier is claimed at most once. Returns one sibling id (or null,
 * meaning insert) per desired row, in order.
 */
export function matchSiblingTierIds(
  desired: Array<{ id?: string | null; name: string }>,
  sourceExisting: ExistingTier[],
  siblingExisting: ExistingTier[]
): Array<string | null> {
  const sourceById = new Map<string, ExistingTier>()
  for (const t of sourceExisting) if (t?.id) sourceById.set(String(t.id), t)
  const sibs = siblingExisting.filter((t) => t?.id && isLiveTier(t))
  const claimed = new Set<string>()
  const result: Array<string | null> = desired.map(() => null)

  const claim = (i: number, pred: (s: ExistingTier) => boolean) => {
    const hit = sibs.find((s) => !claimed.has(String(s.id)) && pred(s))
    if (hit) {
      claimed.add(String(hit.id))
      result[i] = String(hit.id)
    }
  }

  // Pass 1: original source name.
  desired.forEach((row, i) => {
    const src = row.id ? sourceById.get(String(row.id)) : undefined
    if (!src) return
    const name = normName(src.name)
    if (name) claim(i, (s) => normName(s.name) === name)
  })
  // Pass 2: original source sort_order.
  desired.forEach((row, i) => {
    if (result[i]) return
    const src = row.id ? sourceById.get(String(row.id)) : undefined
    if (!src || src.sort_order == null || !Number.isFinite(Number(src.sort_order))) return
    const order = Number(src.sort_order)
    claim(i, (s) => s.sort_order != null && Number(s.sort_order) === order)
  })
  // Pass 3: current row name.
  desired.forEach((row, i) => {
    if (result[i]) return
    const name = normName(row.name)
    if (name) claim(i, (s) => normName(s.name) === name)
  })

  return result
}
