/** What an imported event becomes before it is written as a Tikèm draft. */
export interface DraftInput {
  /** Stable source id (e.g. "eventbrite:123" or the page's event URL): importing twice updates one draft. */
  key: string
  title: string
  description: string
  start: string
  end: string | null
  venue: string
  address: string
  city: string
  /** The venue's country as the source gave it (code or name), or null. */
  country: string | null
  online: boolean
  image: string | null
  url: string | null
  /** Where it came from, e.g. "eventbrite.com" or the page's host. */
  source: string
  /** The currency the source listed, or null when it did not say. */
  currency: string | null
  tiers: Array<{ name: string; price: number; quantity: number }>
  /** The IANA zone the source gives (Eventbrite start.timezone), when it gives one. */
  timezone?: string | null
}

/**
 * A real IANA zone, else null. An imported draft keeps the zone its source
 * states (a Seattle event is shown in Seattle time, not New York's, the
 * default for US): the same rule the Eventbrite sync already follows.
 */
export function validZone(z: unknown): string | null {
  if (typeof z !== 'string' || !z) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return null
  }
}
