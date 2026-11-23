/**
 * Read events off another platform's public page (Eventbrite, Luma, Meetup,
 * an organizer's own site) so an organizer can bring them to Tikèm (like
 * Posh's import). Those pages describe each event for search
 * engines in schema.org JSON-LD; this reads it. Pure (no network): the route
 * fetches the page safely and passes the HTML in.
 */

export interface ImportedEvent {
  /** Stable within the page: the event's own URL or id. */
  uid: string
  title: string
  description: string
  start: string
  end: string | null
  venue: string
  address: string
  city: string
  /** addressCountry as written on the page (a code or a name), or null. */
  country: string | null
  online: boolean
  image: string | null
  url: string | null
  /** Lowest listed price; 0 when free; null when unknown. */
  price: number | null
  currency: string | null
}

const strip = (s: unknown) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&#x27;|&apos;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const httpsOnly = (u: unknown, base: string): string | null => {
  if (!u || typeof u !== 'string') return null
  try {
    const x = new URL(String(u || ''), base)
    return x.protocol === 'https:' ? x.toString() : null
  } catch {
    return null
  }
}

function imageOf(img: any, base: string): string | null {
  if (!img) return null
  if (typeof img === 'string') return httpsOnly(img, base)
  if (Array.isArray(img)) return imageOf(img[0], base)
  return httpsOnly(img.url || img.contentUrl, base)
}

function priceOf(offers: any): { price: number | null; currency: string | null } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : []
  const prices: number[] = []
  let currency: string | null = null
  for (const o of list) {
    for (const v of [o?.price, o?.lowPrice]) {
      const n = Number(v)
      if (v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0) prices.push(n)
    }
    currency = currency || (typeof o?.priceCurrency === 'string' ? o.priceCurrency.toUpperCase().slice(0, 3) : null)
  }
  return { price: prices.length ? Math.min(...prices) : null, currency }
}

/** addressCountry is a code, a name, or a Country object with a name. */
function countryOf(a: any): string | null {
  if (!a || typeof a !== 'object') return null
  const c = a.addressCountry
  const v = typeof c === 'string' ? c : c && typeof c === 'object' ? c.name || c.identifier : null
  const out = strip(v).slice(0, 60)
  return out || null
}

/** Every schema.org Event on the page (also inside @graph and ItemLists), soonest first. */
export function parseImportedEvents(html: string, pageUrl: string): ImportedEvent[] {
  const found: any[] = []
  const visit = (x: any) => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(visit)
    if (Array.isArray(x['@graph'])) x['@graph'].forEach(visit)
    if (Array.isArray(x.itemListElement)) x.itemListElement.forEach((i: any) => visit(i?.item || i))
    const t = x['@type']
    if ((Array.isArray(t) ? t : [t]).some((v: any) => typeof v === 'string' && /Event$/.test(v))) found.push(x)
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()))
    } catch {
      // A broken block on the page: skip it.
    }
  }
  const ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1]
  const seen = new Set<string>()
  const out: ImportedEvent[] = []
  for (const e of found) {
    const start = Date.parse(e.startDate) ? new Date(e.startDate).toISOString() : null
    const title = strip(e.name).slice(0, 120)
    if (!start || !title) continue
    const loc = Array.isArray(e.location) ? e.location[0] : e.location
    const a = loc?.address
    // Some sites already put the town in the street line: don't repeat it.
    const street = typeof a === 'object' ? strip(a?.streetAddress) : ''
    const address =
      typeof a === 'string'
        ? strip(a)
        : [street, ...[a?.addressLocality, a?.addressRegion].map(strip).filter((x) => x && !street.toLowerCase().includes(x.toLowerCase()))].filter(Boolean).join(', ')
    const online = /Online/i.test(String(e.eventAttendanceMode || '')) || loc?.['@type'] === 'VirtualLocation'
    const url = httpsOnly(e.url, pageUrl)
    const uid = String(e['@id'] || url || `${title}|${start}`)
    if (seen.has(uid)) continue
    seen.add(uid)
    const { price, currency } = priceOf(e.offers)
    out.push({
      uid,
      title,
      description: strip(e.description).slice(0, 2000),
      start,
      end: Date.parse(e.endDate) ? new Date(e.endDate).toISOString() : null,
      venue: online ? '' : strip(loc?.name).slice(0, 120),
      address: online ? '' : address.slice(0, 200),
      city: typeof a === 'object' && a?.addressLocality ? strip(a.addressLocality).slice(0, 60) : '',
      country: countryOf(a),
      online,
      image: imageOf(e.image, pageUrl) || (found.length === 1 && ogImage ? httpsOnly(ogImage, pageUrl) : null),
      url,
      price: e.isAccessibleForFree === true ? 0 : price,
      currency,
    })
  }
  return out.sort((x, y) => x.start.localeCompare(y.start))
}
