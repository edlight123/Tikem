/**
 * Eventbrite → Tikèm draft, from Eventbrite's API (v3) after an organizer
 * connects their account. Pure: maps one API event (expanded with venue,
 * ticket_classes and logo) to what lib/import/drafts writes.
 */
import type { DraftInput } from '@/lib/import/draft-input'

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** True when Eventbrite says it is free (or gives no usable price). */
const priceOf = (t: any) => (t?.free ? 0 : Math.max(0, Number(t?.cost?.major_value) || 0))

export function mapEventbriteEvent(ev: any): DraftInput | null {
  const title = clip(ev?.name?.text, 120)
  const start = Date.parse(ev?.start?.utc) ? new Date(ev.start.utc).toISOString() : null
  if (!title || !start || !ev?.id) return null
  const online = ev?.online_event === true
  const v = online ? null : ev?.venue || null
  const tiers = (Array.isArray(ev?.ticket_classes) ? ev.ticket_classes : [])
    .filter((t: any) => t && t.hidden !== true && t.donation !== true)
    .slice(0, 8)
    .map((t: any) => {
      const price = priceOf(t)
      const qty = Number(t?.quantity_total)
      return { name: clip(t.name, 60) || (price ? 'General admission' : 'Free'), price, quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 100000) : 100 }
    })
  const image = ev?.logo?.original?.url || ev?.logo?.url || null
  const currency = clip(ev?.currency || ev?.ticket_classes?.find?.((t: any) => t?.cost?.currency)?.cost?.currency || '', 3).toUpperCase()
  return {
    key: `eventbrite:${ev.id}`,
    title,
    description: clip(ev?.description?.text ?? ev?.summary, 2000),
    start,
    end: Date.parse(ev?.end?.utc) ? new Date(ev.end.utc).toISOString() : null,
    venue: online ? '' : clip(v?.name, 120),
    address: online ? '' : clip(v?.address?.localized_address_display || [v?.address?.address_1, v?.address?.city].filter(Boolean).join(', '), 200),
    city: online ? '' : clip(v?.address?.city, 60),
    country: online ? null : clip(v?.address?.country, 60) || null,
    online,
    image: typeof image === 'string' && image.startsWith('https://') ? image : null,
    url: typeof ev?.url === 'string' && ev.url.startsWith('https://') ? ev.url : null,
    source: 'eventbrite.com',
    currency: currency || null,
    tiers: tiers.length ? tiers : [{ name: 'Free', price: 0, quantity: 100 }],
    timezone: typeof ev?.start?.timezone === 'string' ? ev.start.timezone : null,
  }
}
