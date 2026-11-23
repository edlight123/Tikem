/**
 * "Fill from flyer" in the app composer. The reading happens on the website
 * (POST /api/flyers/read: Tesseract + rules for English, French and Kreyòl),
 * so the app needs no native module and this ships over the air. This file
 * only decides which of the read fields go into the draft: empty ones, and a
 * price only on the untouched default ticket, in a currency the event's
 * country sells in.
 *
 * Pure (no React Native imports) so the website's jest suite can test it.
 */

/** What /api/flyers/read returns (the website's lib/flyer/parse FlyerRead). */
export interface FlyerRead {
  title: string | null
  description: string | null
  date: string | null
  start_time: string | null
  end_time: string | null
  venue_name: string | null
  address: string | null
  city: string | null
  price_type: 'free' | 'paid' | 'unknown'
  price: number | null
  currency: string | null
  age_policy: '18+' | '21+' | null
  dress_code: string | null
  uncertain: string[]
  personal_details: string[]
}

/** The slice of the composer draft a flyer can fill. */
export interface FlyerFillDraft {
  title: string
  description: string
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  venue_name: string
  address: string
  is_online: boolean
  is_rsvp: boolean
  currency: string
  ticket_tiers: Array<{ id?: string; name: string; price: string; [k: string]: unknown }>
  age_policy: string | null
  dress_code: string | null
}

/** "21:00" → "9:00 PM", the composer's own time format. */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${ampm}`
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function flyerDraftPatch(
  r: FlyerRead,
  draft: FlyerFillDraft,
  allowedCurrencies: string[]
): { patch: Partial<FlyerFillDraft>; filled: string[]; check: string[]; currencyNote: string | null } {
  const patch: Partial<FlyerFillDraft> = {}
  const filled: string[] = []
  const take = (field: string, empty: boolean, values: Partial<FlyerFillDraft>) => {
    if (!empty) return
    Object.assign(patch, values)
    filled.push(field)
  }

  if (r.title) take('title', !draft.title.trim(), { title: r.title })
  if (r.description) take('description', !draft.description.trim(), { description: r.description })
  if (r.date) take('date', !draft.start_date, { start_date: r.date, ...(draft.end_date ? {} : { end_date: r.date }) })
  if (r.start_time) take('start_time', !draft.start_time, { start_time: to12h(r.start_time) })
  if (r.end_time && !draft.end_time) {
    const day = patch.start_date || draft.start_date
    // "9PM - 3AM": the end is the next morning.
    const endDay = day && r.start_time && r.end_time <= r.start_time ? nextDay(day) : day
    take('end_time', true, { end_time: to12h(r.end_time), ...(endDay ? { end_date: endDay } : {}) })
  }
  if (r.venue_name || r.address) {
    if (draft.is_online && !draft.venue_name.trim() && !draft.address.trim()) patch.is_online = false
    if (r.venue_name) take('venue_name', !draft.venue_name.trim(), { venue_name: r.venue_name })
    if (r.address) take('address', !draft.address.trim(), { address: r.address })
  }

  let currencyNote: string | null = null
  const single = draft.ticket_tiers.length === 1 ? draft.ticket_tiers[0] : null
  const untouched =
    !!single && !single.id && (single.name === 'General Admission' || !single.name.trim()) && (single.price === '0' || !single.price)
  if (!draft.is_rsvp && untouched && r.price_type === 'paid' && r.price) {
    if (r.currency && allowedCurrencies.includes(r.currency)) {
      take('price', true, { currency: r.currency, ticket_tiers: [{ ...single!, price: String(r.price) }] })
    } else if (r.currency) currencyNote = r.currency
  }

  if (r.age_policy) take('age_policy', !draft.age_policy, { age_policy: r.age_policy })
  if (r.dress_code) take('dress_code', !draft.dress_code, { dress_code: r.dress_code })

  return { patch, filled, check: r.uncertain.filter((f) => filled.includes(f)), currencyNote }
}
