/**
 * "Needs attention": what an IMPORTED event (Eventbrite, a link, a feed) still
 * misses before it reads well on Tikra, shown as a small badge on the
 * organizer's event list and dashboard with the list of things to fix.
 *
 * Imports come in with whatever the source had: no photo, a one-line
 * description, or a category we could only guess. Pure and dependency-free;
 * the Expo app keeps a copy in mobile/lib/needsAttention.ts (parity-tested).
 */

export type AttentionItem = 'category' | 'image' | 'description' | 'date' | 'location'

/** Order the items are listed in. */
export const ATTENTION_ITEMS: AttentionItem[] = ['category', 'image', 'date', 'location', 'description']

/** Shorter than this reads as a summary line, not a description. */
export const MIN_DESCRIPTION_CHARS = 40

const str = (v: unknown) => String(v ?? '').trim()

export function isImportedEvent(e: Record<string, any> | null | undefined): boolean {
  return !!(e && (e.imported_from || e.imported))
}

/**
 * What this event still needs, in display order. Empty for events made on
 * Tikra (the composer requires these), for past and cancelled events.
 */
export function eventNeedsAttention(e: Record<string, any> | null | undefined, now: number = Date.now()): AttentionItem[] {
  if (!e || !isImportedEvent(e)) return []
  if (str(e.status).toLowerCase() === 'cancelled' || e.cancelled_at) return []
  const end = Date.parse(str(e.end_datetime)) || Date.parse(str(e.start_datetime)) || 0
  if (end && end < now) return []

  const out = new Set<AttentionItem>()
  const category = str(e.category)
  // No category, or the general fallback we could only guess.
  if (!category || (category === 'Other' && e.category_auto !== false)) out.add('category')
  if (!str(e.banner_image_url) && !str(e.cover_image_url) && !str(e.image_url)) out.add('image')
  if (!Date.parse(str(e.start_datetime))) out.add('date')
  if (e.is_online !== true && !str(e.venue_name) && !str(e.address) && !str(e.city)) out.add('location')
  // description_len: a cached list that dropped the text kept its length.
  const descLen = typeof e.description === 'string' ? str(e.description).length : Number(e.description_len) || 0
  if (descLen < MIN_DESCRIPTION_CHARS) out.add('description')
  return ATTENTION_ITEMS.filter((i) => out.has(i))
}
