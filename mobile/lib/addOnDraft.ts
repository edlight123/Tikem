/**
 * The app's add-on sheet rules (components/organizer/AddOnsEditor), pure so
 * they are unit-tested:
 *   - what stops a draft from being saved (name, price, sales window);
 *   - ticket restrictions on tickets not saved yet. A new ticket row carries a
 *     local key (`draft_…`); an add-on may be limited to it before the event
 *     is saved. The first write drops those keys (a stored add-on never points
 *     at a missing ticket), and once the tiers exist they are swapped for the
 *     new ticket_tiers doc ids (lib/api/events). The stored shape is unchanged:
 *     tier_ids are doc ids, sales_start / sales_end ISO instants or null.
 */
import type { EventAddOn } from './addOns';

export const DRAFT_TIER_PREFIX = 'draft_';

export function newDraftTierKey(): string {
  return `${DRAFT_TIER_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

export const isDraftTierKey = (id: unknown): boolean => typeof id === 'string' && id.startsWith(DRAFT_TIER_PREFIX);

export type AddOnProblem = 'name' | 'price' | 'window' | null;

/** Why this add-on can't be saved yet, or null. Sales bounds are ISO strings ('' / null = open). */
export function addOnProblem(d: { name: string; price: string; sales_start?: string | null; sales_end?: string | null }): AddOnProblem {
  if (!String(d.name || '').trim()) return 'name';
  const price = Number(String(d.price || '').replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) return 'price';
  const s = d.sales_start ? Date.parse(d.sales_start) : NaN;
  const e = d.sales_end ? Date.parse(d.sales_end) : NaN;
  if (Number.isFinite(s) && Number.isFinite(e) && e <= s) return 'window';
  return null;
}

/** The add-ons with every not-yet-saved ticket key dropped from tier_ids. */
export function stripDraftTierIds<T extends Pick<EventAddOn, 'tier_ids'>>(list: T[]): T[] {
  return (list || []).map((a) => ({ ...a, tier_ids: (a.tier_ids || []).filter((t) => !isDraftTierKey(t)) }));
}

/** True when some add-on is limited to a ticket that has no doc id yet. */
export function hasDraftTierIds(list: Array<Pick<EventAddOn, 'tier_ids'>> | undefined | null): boolean {
  return (list || []).some((a) => (a.tier_ids || []).some(isDraftTierKey));
}

/** Swap local ticket keys for their new doc ids; keys with no doc are dropped. */
export function remapAddOnTierIds<T extends Pick<EventAddOn, 'tier_ids'>>(list: T[], map: Record<string, string>): T[] {
  return (list || []).map((a) => ({
    ...a,
    tier_ids: Array.from(
      new Set((a.tier_ids || []).map((t) => map[t] || t).filter((t) => !isDraftTierKey(t)))
    ),
  }));
}
