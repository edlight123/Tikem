/**
 * Unit tests for the Connect health sweep's pure decisions.
 *
 * The sweep re-asks the publish gate about events that are ALREADY live, because
 * the gate at publish time is point-in-time and a Connect account can go bad
 * afterwards (expiring KYC, disputes, a platform-account migration). What is
 * worth pinning here is which events earn a Stripe call, and the renotify window
 * — an inverted comparison there turns one warning into a daily nag.
 */
import { sweepCandidacy, shouldRenotify } from '@/lib/events/connect-health'

const NOW = new Date('2026-09-11T12:00:00Z')
const FUTURE = new Date('2026-10-01T12:00:00Z').toISOString()
const PAST = new Date('2026-08-01T12:00:00Z').toISOString()

const LIVE_PAID_US = {
  organizer_id: 'org_1',
  start_datetime: FUTURE,
  country: 'US',
  has_paid_tiers: true,
}

describe('sweepCandidacy', () => {
  it('checks a future paid event in a Stripe market', () => {
    expect(sweepCandidacy(LIVE_PAID_US, NOW)).toBe('check')
  })

  it.each(['US', 'CA', 'FR'])('covers %s', (country) => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, country }, NOW)).toBe('check')
  })

  it('skips events that have already happened', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, start_datetime: PAST }, NOW)).toBe('past')
  })

  it('accepts a Firestore Timestamp for start_datetime, not just an ISO string', () => {
    // Events are written both ways across the codebase — see the timestamp
    // field drift that made an earlier reminder query miss most events.
    const asTimestamp = { toDate: () => new Date(PAST) }
    expect(sweepCandidacy({ ...LIVE_PAID_US, start_datetime: asTimestamp }, NOW)).toBe('past')
  })

  it('still checks an event with no usable start date rather than silently skipping it', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, start_datetime: null }, NOW)).toBe('check')
  })

  it('skips free events — they never touch Connect', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, has_paid_tiers: false }, NOW)).toBe('free')
  })

  it('skips RSVP events', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, is_rsvp: true, has_paid_tiers: undefined }, NOW)).toBe('free')
  })

  it('skips Haiti — ungated at publish by design, KYC lands at withdrawal', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, country: 'HT' }, NOW)).toBe('not_stripe_market')
  })

  it('skips an event with no organizer', () => {
    expect(sweepCandidacy({ ...LIVE_PAID_US, organizer_id: '' }, NOW)).toBe('no_organizer')
  })

  it('falls back to the legacy ticket_price when no tier flag is stamped', () => {
    const legacy = { organizer_id: 'org_1', start_datetime: FUTURE, country: 'US', ticket_price: 25 }
    expect(sweepCandidacy(legacy, NOW)).toBe('check')

    const legacyFree = { ...legacy, ticket_price: 0 }
    expect(sweepCandidacy(legacyFree, NOW)).toBe('free')
  })
})

describe('shouldRenotify', () => {
  it('notifies when the organizer has never been told', () => {
    expect(shouldRenotify(null, NOW, 72)).toBe(true)
    expect(shouldRenotify(undefined, NOW, 72)).toBe(true)
  })

  it('stays quiet inside the window', () => {
    const oneHourAgo = new Date(NOW.getTime() - 1 * 60 * 60 * 1000)
    expect(shouldRenotify(oneHourAgo, NOW, 72)).toBe(false)
  })

  it('notifies again once the window has passed', () => {
    const fourDaysAgo = new Date(NOW.getTime() - 96 * 60 * 60 * 1000)
    expect(shouldRenotify(fourDaysAgo, NOW, 72)).toBe(true)
  })

  it('treats the boundary as due', () => {
    const exactly72 = new Date(NOW.getTime() - 72 * 60 * 60 * 1000)
    expect(shouldRenotify(exactly72, NOW, 72)).toBe(true)
  })

  it('accepts a Firestore Timestamp', () => {
    const oneHourAgo = { toDate: () => new Date(NOW.getTime() - 1 * 60 * 60 * 1000) }
    expect(shouldRenotify(oneHourAgo, NOW, 72)).toBe(false)
  })

  it('notifies when the stored timestamp is unreadable rather than going permanently silent', () => {
    expect(shouldRenotify('not-a-date', NOW, 72)).toBe(true)
  })
})
