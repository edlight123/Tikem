/**
 * @jest-environment node
 *
 * Imported Eventbrite events must be able to go live through the REAL publish
 * route (app/api/events/[id]/publish), the one the app's Publish button and
 * the web composer call. Tikra tester 2026-11-23: an imported event "wouldn't
 * move past draft, I had to remake it" (every import was written as country
 * CA, so a USD event hit the currency lock). Here: an Eventbrite event is
 * mapped (lib/import/eventbrite), written as a draft (lib/import/drafts) into
 * an in-memory Firestore, then published.
 *
 * Also the synced copies (lib/import/eventbrite-sync, `eb_<id>`): tickets are
 * sold on Eventbrite, so putting a paused copy back on sale must not hit the
 * Stripe or minimum-price gates, while a client-typed link never earns that.
 */
jest.mock('server-only', () => ({}), { virtual: true })

const docs: Record<string, Record<string, any>> = {}
const key = (col: string, id: string) => `${col}/${id}`
const docRef = (col: string, id: string) => ({
  id,
  get: async () => ({ id, exists: !!docs[key(col, id)], data: () => docs[key(col, id)] }),
  set: async (v: any, opts?: { merge?: boolean }) => {
    docs[key(col, id)] = opts?.merge ? { ...(docs[key(col, id)] || {}), ...v } : { ...v }
  },
  update: async (v: any) => {
    if (!docs[key(col, id)]) throw new Error('not found')
    docs[key(col, id)] = { ...docs[key(col, id)], ...v }
  },
})
const query = (col: string, filters: Array<[string, any]> = []) => ({
  where: (field: string, _op: string, value: any) => query(col, [...filters, [field, value]]),
  limit: () => query(col, filters),
  get: async () => {
    const prefix = `${col}/`
    const hits = Object.entries(docs)
      .filter(([k, v]) => k.startsWith(prefix) && filters.every(([f, val]) => v[f] === val))
      .map(([k, v]) => ({ id: k.slice(prefix.length), data: () => v }))
    return { docs: hits, empty: hits.length === 0, size: hits.length }
  },
})
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({ doc: (id: string) => docRef(col, id), ...query(col) }),
    batch: () => {
      const ops: Array<() => Promise<void>> = []
      return {
        set: (ref: any, v: any) => ops.push(() => ref.set(v)),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
    getAll: async () => [],
    runTransaction: async () => false,
  },
  adminStorage: { bucket: () => ({ file: () => ({}) }) },
}))
jest.mock('@/lib/firestore/organizer-markets', () => ({ getDeclaredMarkets: async () => [] }))
jest.mock('@/lib/import/safe-fetch', () => ({ safeFetchImage: async () => null }))

// The caller: the org owner, signed in.
jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ user: { id: 'org1', email: null, role: 'organizer' }, error: null }) }))
jest.mock('@/lib/admin', () => ({ isAdmin: () => false }))
jest.mock('@/lib/organizer/context', () => ({ canOnEvent: async () => ({ allowed: true }) }))
// No Stripe account yet (memory: zero live Connect accounts): Stripe markets refuse
// a PAID publish; Haiti is "verify at the money" and passes.
const gateCalls: any[] = []
jest.mock('@/lib/events/publish-gate', () => ({
  checkPaidPublishGate: async (p: { country: string }) => {
    gateCalls.push(p)
    return p.country === 'HT'
      ? { ok: true, warnings: [] }
      : { ok: false, status: 403, code: 'stripe_connect_required', error: 'Connect Stripe in Payout settings to sell paid tickets.' }
  },
}))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(), getEventCreatedEmail: jest.fn(), emailSubjects: {} }))
jest.mock('@/lib/email-kit/i18n', () => ({ formatEventWhen: () => null }))
jest.mock('@/lib/email-kit/recipient', () => ({ resolveEmailLang: async () => 'en' }))
jest.mock('@/lib/email-kit/layout', () => ({ appUrl: () => 'https://www.tikem.co' }))
jest.mock('@/lib/firestore/org-brand-server', () => ({ readOrgBrandAdmin: async () => ({ organization_name: 'Lakay' }) }))

import { mapEventbriteEvent } from '@/lib/import/eventbrite'
import { writeDraft } from '@/lib/import/drafts'
import { planEventbriteDoc } from '@/lib/import/eventbrite-sync'
import { isPaidEvent, sellsTicketsElsewhere } from '@/lib/events/paid-event'
import { isEventCurrencyAllowedForCountry } from '@/lib/currency-policy'
import { POST as publish } from '@/app/api/events/[id]/publish/route'

const ctx = { orgId: 'org1', userId: 'org1', orgName: 'Lakay', fallbackCountry: 'HT' }

const ebEvent = (over: any = {}) => ({
  id: '555',
  status: 'live',
  name: { text: 'STRIVE Night' },
  description: { text: 'Konpa all night.' },
  start: { utc: '2027-03-01T03:00:00Z', timezone: 'America/Los_Angeles' },
  end: { utc: '2027-03-01T07:00:00Z' },
  url: 'https://www.eventbrite.com/e/555',
  currency: 'USD',
  venue: { name: 'Hall', address: { city: 'Seattle', region: 'WA', country: 'US', localized_address_display: '1 Main St, Seattle, WA' } },
  ticket_classes: [{ name: 'GA', cost: { major_value: '20.00', currency: 'USD' }, quantity_total: 100 }],
  ...over,
})

async function callPublish(id: string, is_published = true) {
  const req: any = new Request(`https://www.tikem.co/api/events/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_published }),
  })
  const res = await publish(req, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() }
}

async function importOne(ev: any) {
  const d = mapEventbriteEvent(ev)!
  const r = await writeDraft(ctx, d)
  return { id: r.id, flags: r.flags, draft: docs[`events/${r.id}`] }
}

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k]
  gateCalls.length = 0
  docs['users/org1'] = { full_name: 'Lakay', role: 'organizer' }
})

describe('an imported Eventbrite draft goes through the publish route', () => {
  it('a free event publishes in any market, with the venue’s own country and zone', async () => {
    const { id, flags, draft } = await importOne(
      ebEvent({ currency: 'USD', ticket_classes: [{ name: 'RSVP', free: true, quantity_total: 80 }] })
    )
    expect(flags).toEqual([])
    expect(draft).toMatchObject({ country: 'US', currency: 'USD', timezone: 'America/Los_Angeles', is_published: false, status: 'draft', rejected: false, reports_count: 0 })
    expect(isEventCurrencyAllowedForCountry(draft.country, draft.currency)).toBe(true)
    const r = await callPublish(id)
    expect(r).toEqual({ status: 200, body: expect.objectContaining({ success: true, is_published: true }) })
    expect(docs[`events/${id}`]).toMatchObject({ is_published: true, status: 'published' })
    expect(gateCalls).toEqual([])
  })

  it('a paid HT event (HTG) publishes without Stripe', async () => {
    const { id, draft } = await importOne(
      ebEvent({
        currency: 'HTG',
        start: { utc: '2027-03-01T23:00:00Z', timezone: 'America/Port-au-Prince' },
        venue: { name: 'Parc', address: { city: 'Pétion-Ville', country: 'HT' } },
        ticket_classes: [{ name: 'GA', cost: { major_value: '1500.00', currency: 'HTG' }, quantity_total: 200 }],
      })
    )
    expect(draft).toMatchObject({ country: 'HT', currency: 'HTG', has_paid_tiers: true })
    const r = await callPublish(id)
    expect(r.status).toBe(200)
    expect(gateCalls).toEqual([{ organizerId: 'org1', country: 'HT' }])
  })

  it('a paid US (USD) event is refused only for the missing Stripe account, with a code the app turns into a fix', async () => {
    const { id, draft } = await importOne(ebEvent())
    expect(draft).toMatchObject({ country: 'US', currency: 'USD' })
    expect(isEventCurrencyAllowedForCountry(draft.country, draft.currency)).toBe(true)
    const r = await callPublish(id)
    // The currency, the minimum price and the draft's fields all pass; the one
    // refusal is the payout account, and it says so.
    expect(r).toEqual({ status: 403, body: { error: expect.stringMatching(/Stripe/), code: 'stripe_connect_required' } })
    expect(docs[`events/${id}`].is_published).toBe(false)
  })

  it('a paid CA (CAD) or FR (EUR) event lands in its own market, not a blanket one', async () => {
    const ca = await importOne(ebEvent({ id: '556', currency: 'CAD', venue: { name: 'Salle', address: { city: 'Montréal', country: 'CA' } }, start: { utc: '2027-03-01T23:00:00Z', timezone: 'America/Toronto' }, ticket_classes: [{ name: 'GA', cost: { major_value: '15.00', currency: 'CAD' }, quantity_total: 50 }] }))
    const fr = await importOne(ebEvent({ id: '557', currency: 'EUR', venue: { name: 'Salle', address: { city: 'Paris', country: 'FR' } }, start: { utc: '2027-03-01T19:00:00Z', timezone: 'Europe/Paris' }, ticket_classes: [{ name: 'GA', cost: { major_value: '12.00', currency: 'EUR' }, quantity_total: 50 }] }))
    expect(ca.draft).toMatchObject({ country: 'CA', currency: 'CAD', timezone: 'America/Toronto' })
    expect(fr.draft).toMatchObject({ country: 'FR', currency: 'EUR', timezone: 'Europe/Paris' })
    expect((await callPublish(ca.id)).body.code).toBe('stripe_connect_required')
    expect((await callPublish(fr.id)).body.code).toBe('stripe_connect_required')
  })

  it('a price under the market minimum is refused with the fixable code, before the payout gate', async () => {
    const { id, flags } = await importOne(ebEvent({ ticket_classes: [{ name: 'Cheap', cost: { major_value: '1.00', currency: 'USD' }, quantity_total: 10 }] }))
    expect(flags).toContain('price_below_minimum')
    const r = await callPublish(id)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('tier_price_below_minimum')
  })
})

describe('a synced Eventbrite copy sells on Eventbrite (lib/events/paid-event)', () => {
  const NOW = Date.parse('2027-01-15T00:00:00Z')

  function syncedCopy(over: any = {}) {
    const plan = planEventbriteDoc({ ev: ebEvent(over), prev: null, orgId: 'org1', orgName: 'Lakay', now: NOW, fallbackCountry: 'HT' } as any)
    if (plan.kind !== 'write') throw new Error(`no write: ${(plan as any).reason}`)
    // The organizer paused it (unpublished it themselves).
    docs[`events/${plan.id}`] = { ...plan.data, is_published: false, status: 'draft', imported: { ...plan.data.imported, unpublished_by_sync: false } }
    return plan.id
  }

  it('putting a paused paid copy back on sale skips the Stripe and minimum-price gates', async () => {
    const id = syncedCopy({ ticket_classes: [{ name: 'Cheap', cost: { major_value: '1.00', currency: 'USD' }, quantity_total: 10 }] })
    expect(docs[`events/${id}`]).toMatchObject({ has_paid_tiers: true, ticket_price: 1, external_url: 'https://www.eventbrite.com/e/555' })
    const r = await callPublish(id)
    expect(r.status).toBe(200)
    expect(gateCalls).toEqual([])
  })

  it('a link alone (no server-written Eventbrite import) never skips the paid gates', () => {
    const typed = { ticket_price: 25, has_paid_tiers: true, external_url: 'https://www.eventbrite.com/e/123' }
    expect(sellsTicketsElsewhere(typed, [])).toBe(false)
    expect(isPaidEvent(typed, [])).toBe(true)
    // An imported DRAFT (imp_, source "eventbrite.com") sells on Tikèm: still paid.
    expect(isPaidEvent({ ticket_price: 25, imported: { source: 'eventbrite.com' }, external_url: 'https://www.eventbrite.com/e/1' }, [])).toBe(true)
    // Tikèm tiers on the copy, or an unsafe link: paid.
    expect(isPaidEvent({ ticket_price: 25, imported: { source: 'eventbrite' }, external_url: 'https://www.eventbrite.com/e/1' }, [{ price: 25 }])).toBe(true)
    expect(isPaidEvent({ ticket_price: 25, imported: { source: 'eventbrite' }, external_url: 'http://localhost/x' }, [])).toBe(true)
  })

  it('a client-shaped event with a typed ticket link stays gated at publish', async () => {
    docs['events/evX'] = { organizer_id: 'org1', title: 'X', country: 'US', currency: 'USD', ticket_price: 25, has_paid_tiers: true, external_url: 'https://evil.example/pay', is_published: false, status: 'draft' }
    const r = await callPublish('evX')
    expect(r.body.code).toBe('stripe_connect_required')
  })
})
