/**
 * The organizer's add-on editor state (web composer) and its conversion to and
 * from the stored shape (lib/addons/addOns.ts). Text fields stay strings while
 * typing; normalizeAddOns has the last word on save.
 */
import { newAddOnId, normalizeAddOns, type EventAddOn } from '@/lib/addons/addOns'

export interface AddOnDraft {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  /** '' = unlimited. */
  quantity: string
  /** Comma-separated variants as typed ("S, M, L"). */
  options: string
  /** '' = the default per-order limit. */
  maxPerOrder: string
  /** `datetime-local` values ('' = open). */
  salesStart: string
  salesEnd: string
  /** Ticket-tier doc ids the add-on is restricted to (empty = any ticket). */
  tierIds: string[]
  active: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO instant → `datetime-local` value in the viewer's zone ('' when absent). */
export function isoToLocalInputValue(iso: unknown): string {
  if (!iso) return ''
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `datetime-local` value → ISO instant (null when empty or invalid). */
export function localInputValueToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Split "S, M,L" (or one per line) into trimmed, non-empty variants. */
export function parseOptionList(raw: string): string[] {
  return String(raw || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function emptyAddOnDraft(): AddOnDraft {
  return {
    id: newAddOnId(),
    name: '',
    price: '',
    description: '',
    imageUrl: '',
    quantity: '',
    options: '',
    maxPerOrder: '',
    salesStart: '',
    salesEnd: '',
    tierIds: [],
    active: true,
  }
}

export function draftsFromAddOns(raw: unknown): AddOnDraft[] {
  // Stored ids are stock keys: keep them as they are.
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((a: any) => a && typeof a === 'object' && a.id)
    .map((a: any) => ({
      id: String(a.id),
      name: String(a.name || ''),
      price: Number(a.price) > 0 ? String(a.price) : '',
      description: String(a.description || ''),
      imageUrl: String(a.image_url || ''),
      quantity: Number(a.quantity) > 0 ? String(a.quantity) : '',
      options: Array.isArray(a.options) ? a.options.join(', ') : '',
      maxPerOrder: Number(a.max_per_order) > 0 ? String(a.max_per_order) : '',
      salesStart: isoToLocalInputValue(a.sales_start),
      salesEnd: isoToLocalInputValue(a.sales_end),
      tierIds: Array.isArray(a.tier_ids) ? a.tier_ids.map(String) : [],
      active: a.is_active !== false,
    }))
}

/** The stored add-ons for these drafts. Incomplete drafts (no name or price) are dropped. */
export function addOnsFromDrafts(drafts: AddOnDraft[], validTierIds?: string[]): EventAddOn[] {
  const allowed = validTierIds ? new Set(validTierIds) : null
  return normalizeAddOns(
    drafts.map((d) => ({
      id: d.id,
      name: d.name,
      price: d.price,
      description: d.description,
      image_url: d.imageUrl,
      quantity: d.quantity,
      options: parseOptionList(d.options),
      max_per_order: d.maxPerOrder,
      sales_start: localInputValueToIso(d.salesStart),
      sales_end: localInputValueToIso(d.salesEnd),
      tier_ids: allowed ? d.tierIds.filter((t) => allowed.has(t)) : d.tierIds,
      is_active: d.active,
    }))
  )
}

/** A draft the organizer started but cannot save yet (named without a price, or priced without a name). */
export function draftProblem(d: AddOnDraft): 'name' | 'price' | 'window' | null {
  const named = d.name.trim().length > 0
  const priced = Number(d.price) > 0
  if (!named && !priced) return null
  if (!named) return 'name'
  if (!priced) return 'price'
  const s = localInputValueToIso(d.salesStart)
  const e = localInputValueToIso(d.salesEnd)
  if (s && e && new Date(e) <= new Date(s)) return 'window'
  return null
}
