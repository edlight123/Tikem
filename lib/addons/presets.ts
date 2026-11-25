/**
 * Quick starts for the add-on editors: what Haitian organizers sell most with
 * a ticket. Each one only prefills a new row (name, and sizes for merch); the
 * organizer still sets the price, stock and limits. The names are English
 * fallbacks; the editors show the translated `addOns.presets.<key>` string.
 * The app keeps the same list in mobile/lib/addOns.ts (parity-tested).
 */
export const ADD_ON_PRESETS = {
  bottle: { name: 'Bottle package', options: [] as string[] },
  table: { name: 'Table', options: [] as string[] },
  vip: { name: 'VIP upgrade', options: [] as string[] },
  parking: { name: 'Parking', options: [] as string[] },
  drinks: { name: 'Drink tickets', options: [] as string[] },
  merch: { name: 'T-shirt', options: ['S', 'M', 'L', 'XL'] },
} as const

export type AddOnPresetKey = keyof typeof ADD_ON_PRESETS
