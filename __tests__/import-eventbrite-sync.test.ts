import {
  ebEventDocId,
  ebPublication,
  ebStatsFrom,
  mapEventbriteToEventFields,
  planEventbriteDoc,
  planMissingEventbriteDoc,
} from '@/lib/import/eventbrite-sync'

const NOW = Date.parse('2026-11-23T12:00:00Z')

const live = (over: Record<string, any> = {}) => ({
  id: '901',
  status: 'live',
  name: { text: 'Konpa  Night' },
  description: { text: 'Dance all night.\n\n\nBring friends.' },
  start: { utc: '2027-02-21T01:30:00Z', timezone: 'America/New_York' },
  end: { utc: '2027-02-21T04:30:00Z', timezone: 'America/New_York' },
  url: 'https://www.eventbrite.com/e/konpa-night-901',
  currency: 'usd',
  online_event: false,
  capacity: 150,
  venue: {
    name: 'Club Lakay',
    address: { address_1: '1 Main St', city: 'Brooklyn', region: 'NY', country: 'US', localized_address_display: '1 Main St, Brooklyn, NY' },
  },
  logo: { original: { url: 'https://img.evbuc.com/x.jpg' } },
  ticket_classes: [
    { name: 'Adult', free: false, cost: { major_value: '15.00', currency: 'USD' }, quantity_total: 100, quantity_sold: 80 },
    { name: 'Child', free: true, quantity_total: 50, quantity_sold: 30 },
    { name: 'Give', donation: true, quantity_sold: 9 },
  ],
  ...over,
})

const base = { orgId: 'org1', orgName: 'Lakay Events', now: NOW, fallbackCountry: 'HT' }

describe('mapEventbriteToEventFields', () => {
  it('maps title, plain description, UTC times with the event zone, venue, market and price', () => {
    expect(mapEventbriteToEventFields(live())).toMatchObject({
      title: 'Konpa Night',
      description: 'Dance all night.\n\nBring friends.',
      start_datetime: '2027-02-21T01:30:00.000Z',
      end_datetime: '2027-02-21T04:30:00.000Z',
      timezone: 'America/New_York',
      is_online: false,
      venue_name: 'Club Lakay',
      address: '1 Main St, Brooklyn, NY',
      city: 'Brooklyn',
      country: 'US',
      currency: 'USD',
      ticket_price: 15,
      has_paid_tiers: true,
      is_rsvp: false,
      external_url: 'https://www.eventbrite.com/e/konpa-night-901',
      _flags: [],
    })
  })

  it('online events carry no venue, fall back to the org market and a two-hour end', () => {
    const f = mapEventbriteToEventFields(live({ online_event: true, currency: 'htg', ticket_classes: [], start: { utc: '2027-02-21T01:30:00Z', timezone: 'Not/AZone' }, end: null }), 'HT')!
    expect(f.is_online).toBe(true)
    expect(f.venue_name).toBe('')
    expect(f.country).toBe('HT')
    expect(f.currency).toBe('HTG')
    expect(f.timezone).toBe('America/Port-au-Prince')
    expect(f.end_datetime).toBe('2027-02-21T03:30:00.000Z')
  })

  it('needs a title, a start and an id; strips non-https links; flags an unsupported market', () => {
    expect(mapEventbriteToEventFields({ ...live(), name: { text: '' } })).toBeNull()
    expect(mapEventbriteToEventFields({ ...live(), start: {} })).toBeNull()
    expect(mapEventbriteToEventFields(live({ url: 'http://evil.example/e/1' }))!.external_url).toBeNull()
    const uk = live({ currency: 'gbp', venue: { name: 'Hall', address: { city: 'London', country: 'GB' } }, ticket_classes: [{ name: 'GA', cost: { major_value: '10', currency: 'GBP' } }] })
    expect(mapEventbriteToEventFields(uk)!._flags).toEqual(['country_unsupported', 'currency_unsupported'])
  })

  it('a deterministic doc id', () => {
    expect(ebEventDocId('901')).toBe('eb_901')
    expect(ebEventDocId('9/0../1')).toBe('eb_901')
  })
})

describe('ebPublication', () => {
  it('live and started publish; cancelled, draft and ended-early unpublish; ended in the past is a past event', () => {
    expect(ebPublication(live(), NOW)).toMatchObject({ want: 'publish', past: false })
    expect(ebPublication(live({ status: 'started' }), NOW).want).toBe('publish')
    expect(ebPublication(live({ status: 'canceled' }), NOW)).toMatchObject({ want: 'unpublish', reason: 'cancelled' })
    expect(ebPublication(live({ status: 'draft' }), NOW).want).toBe('unpublish')
    expect(ebPublication(live({ status: 'ended' }), NOW)).toMatchObject({ want: 'unpublish', reason: 'ended_early' })
    const old = live({ status: 'completed', start: { utc: '2026-03-01T18:00:00Z' }, end: { utc: '2026-03-01T21:00:00Z' } })
    expect(ebPublication(old, NOW)).toMatchObject({ want: 'publish', past: true })
  })
})

describe('planEventbriteDoc', () => {
  it('creates a published copy owned by the org, with the moderation defaults, tickets on Eventbrite', () => {
    const plan = planEventbriteDoc({ ...base, ev: live(), prev: null, banner: 'https://storage.example/x.jpg' })
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(plan.id).toBe('eb_901')
    expect(plan.created).toBe(true)
    expect(plan.data).toMatchObject({
      organizer_id: 'org1',
      organizer_name: 'Lakay Events',
      is_published: true,
      status: 'published',
      rejected: false,
      reports_count: 0,
      show_on_explore: true,
      country: 'US',
      currency: 'USD',
      banner_image_url: 'https://storage.example/x.jpg',
      external_url: 'https://www.eventbrite.com/e/konpa-night-901',
      created_at: new Date(NOW).toISOString(),
      updated_at: new Date(NOW).toISOString(),
      imported: { source: 'eventbrite', source_event_id: '901', locally_edited: false, unpublished_by_sync: false, image_src: 'https://img.evbuc.com/x.jpg' },
    })
    // Never touches the sales counter or creates tiers: tickets sell on Eventbrite.
    expect(plan.data).not.toHaveProperty('tickets_sold')
    expect(plan.data).not.toHaveProperty('ticket_tiers')
    expect(plan.data).not.toHaveProperty('_image_src')
    expect(plan.data).not.toHaveProperty('_flags')
  })

  it('an event outside our markets or in a currency its market does not take is kept as a flagged draft, never listed', () => {
    const uk = live({ currency: 'gbp', venue: { name: 'Hall', address: { city: 'London', country: 'GB' } }, ticket_classes: [{ name: 'GA', cost: { major_value: '10', currency: 'GBP' } }] })
    const plan = planEventbriteDoc({ ...base, ev: uk, prev: null })
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(plan.published).toBe(false)
    expect(plan.data).toMatchObject({ is_published: false, status: 'draft', rejected: false, reports_count: 0, imported: { review: ['country_unsupported', 'currency_unsupported'], unpublish_reason: 'needs_review' } })
    // A live copy that becomes flagged comes down.
    const wasLive = planEventbriteDoc({ ...base, ev: uk, prev: { organizer_id: 'org1', is_published: true, imported: { source: 'eventbrite' } } })
    expect(wasLive.kind === 'write' && wasLive.data.is_published).toBe(false)
    // Once the organizer edited it here, it is theirs to judge.
    const edited = planEventbriteDoc({ ...base, ev: uk, prev: { organizer_id: 'org1', is_published: true, imported: { source: 'eventbrite', locally_edited: true } } })
    expect(edited.kind === 'write' && edited.data.is_published).toBe(true)
  })

  it('a low price does not hold back a synced event (tickets sell on Eventbrite)', () => {
    const cheap = live({ ticket_classes: [{ name: 'GA', cost: { major_value: '1', currency: 'USD' } }] })
    const plan = planEventbriteDoc({ ...base, ev: cheap, prev: null })
    expect(plan.kind === 'write' && plan.data.is_published).toBe(true)
  })

  it('cancelled on Eventbrite unpublishes the live copy (never deletes)', () => {
    const prev = { organizer_id: 'org1', is_published: true, status: 'published', imported: { source: 'eventbrite', source_event_id: '901' } }
    const plan = planEventbriteDoc({ ...base, ev: live({ status: 'canceled' }), prev })
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(plan.unpublished).toBe(true)
    expect(plan.data).toMatchObject({ is_published: false, status: 'draft', imported: { unpublished_by_sync: true, unpublish_reason: 'cancelled' } })
    // An existing doc keeps its moderation fields: never reset on a resync.
    expect(plan.data).not.toHaveProperty('rejected')
    expect(plan.data).not.toHaveProperty('reports_count')
    expect(plan.data).not.toHaveProperty('created_at')
  })

  it('republishes what a sync took down, but never what the organizer unpublished', () => {
    const tookDown = { organizer_id: 'org1', is_published: false, status: 'draft', imported: { source: 'eventbrite', unpublished_by_sync: true } }
    const p1 = planEventbriteDoc({ ...base, ev: live(), prev: tookDown })
    expect(p1.kind === 'write' && p1.data.is_published).toBe(true)

    const theirs = { organizer_id: 'org1', is_published: false, status: 'draft', imported: { source: 'eventbrite', unpublished_by_sync: false } }
    const p2 = planEventbriteDoc({ ...base, ev: live(), prev: theirs })
    expect(p2.kind).toBe('write')
    if (p2.kind !== 'write') return
    expect(p2.data).not.toHaveProperty('is_published')
    expect(p2.data).not.toHaveProperty('status')
  })

  it('never reopens a closed event: rejected, cancelled, under review, frozen, or a banned organizer', () => {
    for (const closed of [{ rejected: true }, { status: 'cancelled' }, { cancelled_at: '2026-11-01T00:00:00Z' }, { hidden_pending_review: true }, { payouts_frozen: true }]) {
      const prev = { organizer_id: 'org1', is_published: false, ...closed, imported: { source: 'eventbrite', unpublished_by_sync: true } }
      const p = planEventbriteDoc({ ...base, ev: live(), prev })
      expect(p.kind === 'write' && p.data.is_published).toBeUndefined()
    }
    expect(planEventbriteDoc({ ...base, ev: live(), prev: null, organizer: { status: 'banned' } })).toEqual({ kind: 'skip', reason: 'not_live' })
  })

  it('respects locally_edited: only time, link, publication and stats are refreshed', () => {
    const prev = {
      organizer_id: 'org1',
      is_published: true,
      title: 'Our own title',
      description: 'Our words',
      banner_image_url: 'https://storage.example/ours.jpg',
      imported: { source: 'eventbrite', source_event_id: '901', locally_edited: true, image_src: 'https://img.evbuc.com/old.jpg' },
    }
    const ev = live({ start: { utc: '2027-02-22T01:30:00Z', timezone: 'America/New_York' }, end: { utc: '2027-02-22T04:30:00Z' } })
    const plan = planEventbriteDoc({ ...base, ev, prev, banner: 'https://storage.example/new.jpg' })
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(plan.data).not.toHaveProperty('title')
    expect(plan.data).not.toHaveProperty('description')
    expect(plan.data).not.toHaveProperty('banner_image_url')
    expect(plan.data).not.toHaveProperty('currency')
    expect(plan.data).toMatchObject({
      start_datetime: '2027-02-22T01:30:00.000Z',
      end_datetime: '2027-02-22T04:30:00.000Z',
      timezone: 'America/New_York',
      external_url: 'https://www.eventbrite.com/e/konpa-night-901',
      is_published: true,
      imported: { locally_edited: true },
    })
    const gone = planEventbriteDoc({ ...base, ev: live({ status: 'canceled' }), prev })
    expect(gone.kind === 'write' && gone.data.is_published).toBe(false)
  })

  it('past events carry Eventbrite public counts, and keep them when not refetched', () => {
    const ev = live({ status: 'completed', start: { utc: '2026-03-01T18:00:00Z', timezone: 'America/New_York' }, end: { utc: '2026-03-01T21:00:00Z' } })
    const stats = ebStatsFrom(ev, 97)
    const plan = planEventbriteDoc({ ...base, ev, prev: null, stats })
    expect(plan.kind).toBe('write')
    if (plan.kind !== 'write') return
    expect(plan.past).toBe(true)
    expect(plan.data.stats).toEqual({ attended: 97, tickets_sold: 110 })
    expect(plan.data.imported.stats_fetched_at).toBe(new Date(NOW).toISOString())
    const again = planEventbriteDoc({ ...base, ev, prev: { organizer_id: 'org1', is_published: true, ...plan.data } })
    expect(again.kind === 'write' && again.data).not.toHaveProperty('stats')
  })

  it('does not mirror events older than the window, cancelled ones never listed, or other accounts’ docs', () => {
    const ancient = live({ status: 'completed', start: { utc: '2023-01-01T18:00:00Z' }, end: { utc: '2023-01-01T21:00:00Z' } })
    expect(planEventbriteDoc({ ...base, ev: ancient, prev: null })).toEqual({ kind: 'skip', reason: 'not_live' })
    expect(planEventbriteDoc({ ...base, ev: live({ status: 'canceled' }), prev: null })).toEqual({ kind: 'skip', reason: 'not_live' })
    expect(planEventbriteDoc({ ...base, ev: live(), prev: { organizer_id: 'someone-else' } })).toEqual({ kind: 'skip', reason: 'conflict' })
    expect(planEventbriteDoc({ ...base, ev: live(), prev: { organizer_id: 'org1', imported: { source: 'other' } } })).toEqual({ kind: 'skip', reason: 'not_ours' })
  })
})

describe('planMissingEventbriteDoc', () => {
  it('unpublishes an upcoming copy Eventbrite no longer lists, leaves past and hidden ones alone', () => {
    const prev = { is_published: true, start_datetime: '2027-01-01T18:00:00Z', end_datetime: '2027-01-01T20:00:00Z', imported: { source: 'eventbrite', source_event_id: '5' } }
    expect(planMissingEventbriteDoc(prev, NOW)).toMatchObject({ is_published: false, status: 'draft', imported: { unpublished_by_sync: true, source_event_id: '5' } })
    expect(planMissingEventbriteDoc({ ...prev, end_datetime: '2026-01-01T20:00:00Z' }, NOW)).toBeNull()
    expect(planMissingEventbriteDoc({ ...prev, is_published: false }, NOW)).toBeNull()
  })
})

describe('ebStatsFrom', () => {
  it('sums tickets sold (not donations), keeps no capacity, and is null when unknown', () => {
    expect(ebStatsFrom(live(), null)).toEqual({ attended: null, tickets_sold: 110 })
    expect(ebStatsFrom(live(), 12)).toEqual({ attended: 12, tickets_sold: 110 })
    expect(ebStatsFrom({ ticket_classes: [] }, null)).toBeNull()
  })
})
