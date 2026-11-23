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
}
