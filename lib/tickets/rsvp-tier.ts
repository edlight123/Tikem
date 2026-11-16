/**
 * RSVP mode on the web composer sells no tiers: saving it used to orphan every
 * tier doc of the event. That is right for a web RSVP (it never had one), but a
 * mobile RSVP keeps its seats in ONE free tier doc ("RSVP", capped at the
 * attendance limit). Orphaning it archived it (`is_active: false`) as soon as
 * anyone had RSVP'd, and from then on every claim was refused: the claim route
 * picks the event's free tier and refuses an inactive one. So an RSVP save
 * keeps that tier, with its own cap, sold count and id, and only switches it
 * back on.
 */
import { isLiveTier, soldQuantityOf } from '@/lib/tickets/tier-reconcile'

/**
 * Whether a stored event (or a guest draft) is an RSVP. `is_rsvp` decides when
 * present (mobile has always written it; the web writes it now); older web
 * events only carry `ticket_name: 'RSVP'`. Mirrored in mobile/lib/composerFields.ts.
 */
export function isRsvpEvent(event: { is_rsvp?: unknown; ticket_name?: unknown } | null | undefined): boolean {
  if (typeof event?.is_rsvp === 'boolean') return event.is_rsvp
  return event?.ticket_name === 'RSVP'
}

/** The free tier an RSVP event's seats live in, if it has one. */
export function rsvpTierToKeep<T extends Record<string, any>>(existing: T[]): T | null {
  const free = existing
    .filter((t) => t && isLiveTier(t) && Number(t.price ?? 0) === 0)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
  // A tier people already hold seats in wins over an untouched one.
  return free.find((t) => soldQuantityOf(t) > 0) || free[0] || null
}

/** The editable fields an RSVP save writes back onto that tier: its own, turned on. */
export function rsvpTierFields(tier: Record<string, any>) {
  const quantity = Math.floor(Number(tier.total_quantity ?? tier.quantity ?? 0)) || 0
  const toIso = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    quantity,
    fields: {
      name: String(tier.name || 'RSVP'),
      price: 0,
      quantity,
      unlimited: tier.unlimited === true,
      description: typeof tier.description === 'string' && tier.description ? tier.description : null,
      // An RSVP is open to everyone who can see the event.
      is_active: true,
      max_per_order: Number(tier.max_per_order) > 0 ? Math.floor(Number(tier.max_per_order)) : null,
      enable_waitlist: tier.enable_waitlist === true,
      sales_start: toIso(tier.sales_start),
      sales_end: toIso(tier.sales_end),
      valid_from: toIso(tier.valid_from),
      valid_until: toIso(tier.valid_until),
    },
  }
}
