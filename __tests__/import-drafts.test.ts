/**
 * @jest-environment node
 *
 * The shared draft writer (lib/import/drafts) and the Eventbrite token store
 * (lib/import/eventbrite-server), against an in-memory Firestore.
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
})
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({ doc: (id: string) => docRef(col, id) }),
    batch: () => {
      const ops: Array<() => Promise<void>> = []
      return {
        set: (ref: any, v: any) => ops.push(() => ref.set(v)),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
  },
  adminStorage: { bucket: () => ({ file: () => ({}) }) },
}))
jest.mock('@/lib/firestore/organizer-markets', () => ({ getDeclaredMarkets: async () => [] }))
jest.mock('@/lib/import/safe-fetch', () => ({ safeFetchImage: async () => null }))

import { importDraftId, importMustSkip, writeDraft } from '@/lib/import/drafts'
import type { DraftInput } from '@/lib/import/draft-input'

const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  key: 'eventbrite:42',
  title: 'Kompa Fest',
  description: 'All night',
  start: '2027-03-01T23:00:00.000Z',
  end: null,
  venue: 'Parc',
  address: '1 Rue X, Pétion-Ville',
  city: 'Pétion-Ville',
  country: 'HT',
  online: false,
  image: null,
  url: 'https://www.eventbrite.com/e/42',
  source: 'eventbrite.com',
  currency: 'HTG',
  tiers: [
    { name: 'GA', price: 1500, quantity: 200 },
    { name: 'VIP', price: 5000, quantity: 50 },
  ],
  ...over,
})
const ctx = { orgId: 'org1', userId: 'user1', orgName: 'Lakay', fallbackCountry: 'HT' }

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k]
})

describe('writeDraft', () => {
  it('writes a draft like the composer: moderation defaults, ISO created_at, market, ticket types', async () => {
    const r = await writeDraft(ctx, input())
    expect(r).toMatchObject({ id: importDraftId('org1', 'eventbrite:42'), flags: [] })
    const ev = docs[`events/${r.id}`]
    expect(ev).toMatchObject({
      organizer_id: 'org1',
      created_by: 'user1',
      is_published: false,
      status: 'draft',
      rejected: false,
      reports_count: 0,
      country: 'HT',
      currency: 'HTG',
      timezone: 'America/Port-au-Prince',
      ticket_price: 1500,
      has_paid_tiers: true,
      is_rsvp: false,
      total_tickets: 250,
      end_datetime: '2027-03-02T01:00:00.000Z',
      imported: { source: 'eventbrite.com', key: 'eventbrite:42', review: [] },
    })
    expect(Date.parse(ev.created_at)).toBeGreaterThan(0)
    expect(typeof ev.created_at).toBe('string')
    expect(ev).not.toHaveProperty('tickets_sold')
    expect(docs[`ticket_tiers/${r.id}-t0`]).toMatchObject({ event_id: r.id, name: 'GA', price: 1500, total_quantity: 200, sold_quantity: 0, is_active: true })
    expect(docs[`ticket_tiers/${r.id}-t1`]).toMatchObject({ name: 'VIP', price: 5000, sort_order: 1 })
  })

  it('re-importing a draft updates it in place, keeps created_at and the organizer’s tiers', async () => {
    const first = await writeDraft(ctx, input())
    const created = docs[`events/${first.id}`].created_at
    docs[`ticket_tiers/${first.id}-t0`].name = 'Renamed by organizer'
    await writeDraft(ctx, input({ title: 'Kompa Fest 2027' }))
    expect(docs[`events/${first.id}`]).toMatchObject({ title: 'Kompa Fest 2027', created_at: created })
    expect(docs[`ticket_tiers/${first.id}-t0`].name).toBe('Renamed by organizer')
  })

  it('never reopens a live or closed event, and never takes over another org’s doc', async () => {
    const id = importDraftId('org1', 'eventbrite:42')
    for (const closed of [{ is_published: true }, { rejected: true }, { status: 'cancelled' }, { hidden_pending_review: true }, { payouts_frozen: true }, { cancelled_at: 'x' }]) {
      docs[`events/${id}`] = { organizer_id: 'org1', title: 'Closed', ...closed }
      expect(await writeDraft(ctx, input())).toMatchObject({ id, skipped: true })
      expect(docs[`events/${id}`].title).toBe('Closed')
    }
    docs[`events/${id}`] = { organizer_id: 'intruder', title: 'Squat' }
    expect(await writeDraft(ctx, input())).toMatchObject({ skipped: true })
    expect(docs[`events/${id}`].organizer_id).toBe('intruder')
  })

  it('flags a paid import in a currency its market does not take, priced in the market currency', async () => {
    const r = await writeDraft(ctx, input({ country: 'FR', currency: 'GBP', city: 'Paris' }))
    expect(r).toMatchObject({ flags: ['currency_unsupported'], sourceCurrency: 'GBP' })
    expect(docs[`events/${r.id}`]).toMatchObject({ country: 'FR', currency: 'EUR', is_published: false, imported: { review: ['currency_unsupported'], source_currency: 'GBP' } })
  })

  it('importMustSkip covers every closed state', () => {
    expect(importMustSkip(null)).toBe(false)
    expect(importMustSkip({ status: 'draft' })).toBe(false)
    expect(importMustSkip({ status: 'published' })).toBe(true)
  })
})

describe('Eventbrite token storage', () => {
  beforeAll(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  })

  it('stores the token encrypted, turns auto-sync on, and reads it back', async () => {
    const { saveToken, loadToken } = await import('@/lib/import/eventbrite-server')
    await saveToken('org1', 'secret-token', 'user1')
    expect(JSON.stringify(docs['organizer_integrations/org1'])).not.toContain('secret-token')
    expect(docs['organizer_integrations/org1'].eventbrite).toMatchObject({ auto_sync: true, connected_by: 'user1' })
    expect(await loadToken('org1')).toBe('secret-token')
  })

  it('a different key cannot read it, and without all three secrets Eventbrite is off', async () => {
    const { saveToken, loadToken, eventbriteConfigured } = await import('@/lib/import/eventbrite-server')
    await saveToken('org1', 'secret-token', 'user1')
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
    expect(await loadToken('org1')).toBeNull()
    delete process.env.EVENTBRITE_CLIENT_ID
    process.env.EVENTBRITE_CLIENT_SECRET = 's'
    expect(eventbriteConfigured()).toBe(false)
    process.env.EVENTBRITE_CLIENT_ID = 'id'
    expect(eventbriteConfigured()).toBe(true)
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'short'
    expect(eventbriteConfigured()).toBe(false)
  })
})
