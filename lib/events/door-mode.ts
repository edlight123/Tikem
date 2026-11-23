// The composer's three modes: sell tickets, RSVP, or pay at the
// door. A door event stores its tiers at price 0 with the amount in
// door_price (lib/tickets/pay-at-door), so it never meets the paid gate.
// Mirrored for the app in mobile/lib/composerFields.ts.

import { doorPriceOf, isDoorEvent } from '@/lib/tickets/pay-at-door'

export type ComposerMode = 'tickets' | 'rsvp' | 'door'

export function composerModeOf(event: any, tiers: any[] = []): ComposerMode {
  if (!event && tiers.length === 0) return 'tickets'
  if (isDoorEvent(event, tiers)) return 'door'
  if (event?.is_rsvp === true || event?.ticket_name === 'RSVP') return 'rsvp'
  return 'tickets'
}

/** The amount the editor shows for a stored tier: its door price on a door tier, else its price. */
export function tierEditorPrice(tier: { price?: unknown; door_price?: unknown }): string {
  const door = doorPriceOf(tier)
  return String(door > 0 ? door : Number(tier?.price ?? 0) || 0)
}

/** What a tier row saves as: in door mode the typed amount is the door price, and price is 0. */
export function doorTierSaveFields(mode: ComposerMode, typed: number): { price: number; door_price: number | null } {
  const n = Number.isFinite(typed) && typed > 0 ? typed : 0
  return mode === 'door' ? { price: 0, door_price: n } : { price: n, door_price: null }
}

/** Once anyone has reserved at the door, the event stays pay-at-the-door. */
export function canLeaveDoorMode(tiers: Array<{ soldQuantity?: number }>): boolean {
  return tiers.every((t) => !(Number(t.soldQuantity) > 0))
}

/** The lowest door price among the tiers (stored on the event for cards), or null. */
export function lowestDoorPrice(tiers: Array<{ door_price?: number | null }>): number | null {
  const prices = tiers.map((t) => Number(t.door_price)).filter((n) => Number.isFinite(n) && n > 0)
  return prices.length ? Math.min(...prices) : null
}
