// Pay at the door: reserve free online, pay the organizer on arrival. Tikem
// takes NO fee on door cash and pays none of it out. A door tier is an
// ordinary ticket_tiers doc with price 0 plus door_price > 0, so every
// paid-money path (card, MonCash, payouts, fees) keeps treating it as free;
// cash collected lives in door_* fields, never in price_paid.
// Mirrored in mobile/lib/payAtDoor.ts (parity test).

/** A family can reserve together; the free-claim cap (2) stays for free tiers. */
export const MAX_DOOR_TICKETS_PER_PERSON = 6

type TierLike = { price?: unknown; door_price?: unknown } | null | undefined

const cents = (n: number) => Math.round(n * 100) / 100

/** The price paid at the door: `door_price` on a tier that costs nothing online, else 0. */
export function doorPriceOf(tier: TierLike): number {
  if (!tier) return 0
  if (Math.round(Number(tier.price || 0) * 100) !== 0) return 0
  const n = Number(tier.door_price)
  return Number.isFinite(n) && n > 0 ? cents(n) : 0
}

export function isDoorTier(tier: TierLike): boolean {
  return doorPriceOf(tier) > 0
}

export function isDoorEvent(event: { pay_at_door?: unknown } | null | undefined, tiers: unknown[] = []): boolean {
  return event?.pay_at_door === true || (Array.isArray(tiers) && tiers.some((t) => isDoorTier(t as TierLike)))
}

/** Fields stamped on a door ticket. Tikem takes nothing: price_paid stays 0. */
export function doorTicketFields(tier: TierLike, currency: string) {
  return {
    payment_method: 'pay_at_door' as const,
    door_price: doorPriceOf(tier),
    door_currency: String(currency || 'HTG').toUpperCase(),
    door_paid: false as const,
  }
}

/** What a ticket owes at the door, or null when it is not a door ticket. */
export function doorBalance(ticket: Record<string, any> | null | undefined): { owes: number; currency: string; paid: boolean } | null {
  if (!ticket || ticket.payment_method !== 'pay_at_door') return null
  const paid = ticket.door_paid === true
  const price = Number(ticket.door_price) > 0 ? cents(Number(ticket.door_price)) : 0
  return { owes: paid ? 0 : price, currency: String(ticket.door_currency || 'HTG').toUpperCase(), paid }
}

// Live ticket statuses (lib/tickets/status vocabulary): valid | confirmed | active.
const LIVE = new Set(['valid', 'confirmed', 'active'])

/** Cash collected at the door over live, paid door tickets, cent-exact. */
export function doorCollectedTotal(tickets: Array<Record<string, any>>): number {
  let c = 0
  for (const t of tickets) {
    if (t?.payment_method !== 'pay_at_door' || t.door_paid !== true || !LIVE.has(String(t.status || '').toLowerCase())) continue
    const amount = Number(t.door_amount ?? t.door_price)
    if (Number.isFinite(amount) && amount > 0) c += Math.round(amount * 100)
  }
  return c / 100
}

/** The lowest door price among the tiers (stored on the event for cards), or null. */
export function lowestDoorPrice(tiers: Array<{ price?: unknown; door_price?: unknown }> | null | undefined): number | null {
  const prices = (Array.isArray(tiers) ? tiers : []).map((t) => doorPriceOf(t)).filter((n) => n > 0)
  return prices.length ? Math.min(...prices) : null
}

const group = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep)

/**
 * The amount alone, in the event's currency: "HTG 1,500" (en, ht) or
 * "1 500 HTG" (fr). Whole amounts drop the cents. Deterministic on purpose
 * (no Intl), so the web and the app print exactly the same thing.
 */
export function doorMoney(amount: number, currency: string, lang: string = 'en'): string {
  const code = String(currency || 'HTG').toUpperCase()
  const fr = String(lang || '').startsWith('fr')
  const value = cents(Math.max(0, Number(amount) || 0))
  const whole = Math.round(value * 100) % 100 === 0
  const [int, dec] = (whole ? String(Math.round(value)) : value.toFixed(2)).split('.')
  const n = group(int, fr ? '\u202f' : ',') + (dec ? (fr ? ',' : '.') + dec : '')
  return fr ? `${n} ${code}` : `${code} ${n}`
}

const AT_THE_DOOR: Record<string, string> = { en: 'at the door', fr: 'à l’entrée', ht: 'nan pòt la' }

/** "HTG 500 at the door" / "500 HTG à l’entrée" / "HTG 500 nan pòt la". */
export function doorPriceLabel(amount: number, currency: string, lang: string = 'en'): string {
  const key = String(lang || 'en').slice(0, 2)
  return `${doorMoney(amount, currency, lang)} ${AT_THE_DOOR[key] || AT_THE_DOOR.en}`
}
