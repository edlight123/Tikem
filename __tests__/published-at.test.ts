/**
 * published_at (lib/events/publishedAt): stamped on the FIRST publish, kept on
 * a republish, and backfilled for older events from live_email_sent_at, else
 * created_at. Home's "Recently added" rail ranks by it, so an old draft
 * published today counts as new.
 */
import { backfillPublishedAt, firstPublishStamp } from '@/lib/events/publishedAt'
import { selectNewOnTikem } from '@/lib/home/new-on-tikem'
import { selectNewOnTikem as selectMobile } from '../mobile/lib/newOnTikem'

describe('firstPublishStamp', () => {
  it('stamps an event never published', () => {
    expect(firstPublishStamp({}, '2026-11-25T12:00:00.000Z')).toEqual({ published_at: '2026-11-25T12:00:00.000Z' })
    expect(firstPublishStamp(null, '2026-11-25T12:00:00.000Z')).toEqual({ published_at: '2026-11-25T12:00:00.000Z' })
  })
  it('keeps the first stamp on a republish', () => {
    expect(firstPublishStamp({ published_at: '2026-10-01T00:00:00.000Z' })).toEqual({})
  })
})

describe('backfillPublishedAt', () => {
  it('prefers live_email_sent_at, then created_at', () => {
    expect(
      backfillPublishedAt({ is_published: true, live_email_sent_at: '2026-11-20T10:00:00Z', created_at: '2026-09-01T00:00:00Z' })
    ).toEqual({ published_at: '2026-11-20T10:00:00.000Z', from: 'live_email_sent_at' })
    expect(backfillPublishedAt({ is_published: true, created_at: { _seconds: Date.parse('2026-09-01T00:00:00Z') / 1000 } })).toEqual({
      published_at: '2026-09-01T00:00:00.000Z',
      from: 'created_at',
    })
  })
  it('skips drafts, stamped events and unknown times', () => {
    expect(backfillPublishedAt({ is_published: false, created_at: '2026-09-01T00:00:00Z' })).toBeNull()
    expect(backfillPublishedAt({ is_published: true, published_at: '2026-11-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' })).toBeNull()
    expect(backfillPublishedAt({ is_published: true })).toBeNull()
  })
})

describe('Recently added: an old draft published today', () => {
  it('is picked by its published_at, not its old created_at (web and app)', () => {
    const now = Date.parse('2026-11-25T12:00:00Z')
    const ev = {
      id: 'old-draft',
      title: 'Kompa gala',
      country: 'CA',
      city: 'Toronto',
      is_published: true,
      status: 'published',
      created_at: '2026-08-01T00:00:00Z',
      published_at: '2026-11-25T11:00:00.000Z',
      start_datetime: '2026-12-10T23:00:00Z',
    }
    expect(selectNewOnTikem([ev], { now, country: 'CA', min: 1 }).map((e) => e.id)).toEqual(['old-draft'])
    expect(selectMobile([ev], { now, country: 'CA', min: 1 }).map((e) => e.id)).toEqual(['old-draft'])
  })
})
