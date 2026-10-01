/**
 * Tracking-link sale counting (lib/tracking-links.ts): exactly-once per
 * (link, order) and revenue kept per currency.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)

// Required (not imported) so the module loads after the fake exists.
const {
  recordTrackingLinkSale,
  recordAttributedSale,
  resolveOrderAttribution,
  incrementTrackingLinkClick,
  serializeTrackingLink,
} = require('@/lib/tracking-links') as typeof import('@/lib/tracking-links')

const LINK = 'LinkAAAAAAAAAAAAAAAA'
const OTHER_EVENT_LINK = 'LinkBBBBBBBBBBBBBBBB'

beforeEach(() => {
  mockFake.reset()
  mockFake.seed('tracking_links', LINK, {
    event_id: 'evt1',
    label: 'IG story',
    clicks: 0,
    sales_count: 0,
    tickets_count: 0,
    revenue_by_currency: {},
  })
  mockFake.seed('tracking_links', OTHER_EVENT_LINK, { event_id: 'evt2', clicks: 0, sales_count: 0 })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('recordTrackingLinkSale', () => {
  it('counts an order once, however many times fulfillment reports it', async () => {
    const sale = { trackingLinkId: LINK, eventId: 'evt1', orderKey: 'pi_123', quantity: 2, revenueCents: 300000, currency: 'HTG' }

    expect(await recordTrackingLinkSale(sale)).toEqual({ recorded: true })
    // Webhook redelivery / client-confirm race / retried claim: same order key.
    expect(await recordTrackingLinkSale(sale)).toEqual({ recorded: false, reason: 'duplicate' })
    expect(await recordTrackingLinkSale({ ...sale, revenueCents: 999 })).toEqual({ recorded: false, reason: 'duplicate' })

    const link = mockFake.get('tracking_links', LINK)!
    expect(link.sales_count).toBe(1)
    expect(link.tickets_count).toBe(2)
    expect(link.revenue_by_currency).toEqual({ HTG: 300000 })
    expect(mockFake.all('tracking_link_sales')).toHaveLength(1)
  })

  it('keeps each currency separate and never sums them', async () => {
    await recordTrackingLinkSale({ trackingLinkId: LINK, eventId: 'evt1', orderKey: 'o1', quantity: 1, revenueCents: 150000, currency: 'HTG' })
    await recordTrackingLinkSale({ trackingLinkId: LINK, eventId: 'evt1', orderKey: 'o2', quantity: 1, revenueCents: 2500, currency: 'usd' })
    await recordTrackingLinkSale({ trackingLinkId: LINK, eventId: 'evt1', orderKey: 'o3', quantity: 3, revenueCents: 450000, currency: 'HTG' })

    const link = mockFake.get('tracking_links', LINK)!
    expect(link.sales_count).toBe(3)
    expect(link.tickets_count).toBe(5)
    expect(link.revenue_by_currency).toEqual({ HTG: 600000, USD: 2500 })
    expect(serializeTrackingLink(LINK, link as any).revenueByCurrency).toEqual({ HTG: 600000, USD: 2500 })
  })

  it('a free order counts as a sale but adds no revenue key', async () => {
    await recordTrackingLinkSale({ trackingLinkId: LINK, eventId: 'evt1', orderKey: 'free_t1', quantity: 1, revenueCents: 0, currency: 'HTG' })
    const link = mockFake.get('tracking_links', LINK)!
    expect(link.sales_count).toBe(1)
    expect(link.revenue_by_currency).toEqual({})
  })

  it('refuses a link from another event, and junk currencies', async () => {
    expect(
      await recordTrackingLinkSale({ trackingLinkId: OTHER_EVENT_LINK, eventId: 'evt1', orderKey: 'o1', quantity: 1, revenueCents: 100, currency: 'HTG' })
    ).toEqual({ recorded: false, reason: 'not_found' })
    expect(
      await recordTrackingLinkSale({ trackingLinkId: LINK, eventId: 'evt1', orderKey: 'o1', quantity: 1, revenueCents: 100, currency: 'HT.G' })
    ).toEqual({ recorded: false, reason: 'invalid' })
    expect(mockFake.get('tracking_links', OTHER_EVENT_LINK)!.sales_count).toBe(0)
    expect(mockFake.all('tracking_link_sales')).toHaveLength(0)
  })

  it('recordAttributedSale is a no-op without a tracking link id', async () => {
    expect(
      await recordAttributedSale(
        { tracking_link_id: null, utm_source: 'ig', utm_medium: null, utm_campaign: null, promoter_ref: 'X1' },
        { eventId: 'evt1', orderKey: 'o1', quantity: 1, revenueCents: 100, currency: 'HTG' }
      )
    ).toBeNull()
    expect(mockFake.get('tracking_links', LINK)!.sales_count).toBe(0)
  })
})

describe('resolveOrderAttribution', () => {
  it('drops a forged link id from another event but keeps the utm data', async () => {
    const a = await resolveOrderAttribution('evt1', { t: OTHER_EVENT_LINK, utm_source: 'ig' }, null)
    expect(a).toMatchObject({ tracking_link_id: null, utm_source: 'ig' })
    const ok = await resolveOrderAttribution('evt1', { t: LINK }, 'STEEVE')
    expect(ok).toMatchObject({ tracking_link_id: LINK, promoter_ref: 'STEEVE' })
  })
})

describe('incrementTrackingLinkClick', () => {
  it('counts only links that belong to the event', async () => {
    expect(await incrementTrackingLinkClick('evt1', LINK)).toBe(true)
    expect(await incrementTrackingLinkClick('evt1', LINK)).toBe(true)
    expect(await incrementTrackingLinkClick('evt1', OTHER_EVENT_LINK)).toBe(false)
    expect(await incrementTrackingLinkClick('evt1', 'nope')).toBe(false)
    expect(mockFake.get('tracking_links', LINK)!.clicks).toBe(2)
    expect(mockFake.get('tracking_links', OTHER_EVENT_LINK)!.clicks).toBe(0)
  })
})
