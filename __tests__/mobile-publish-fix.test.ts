import { canOfferPublish, publishFixFor } from '../mobile/lib/publishFix'

const NOW = Date.parse('2027-01-01T00:00:00Z')

describe('publish from the event screen (mobile/lib/publishFix)', () => {
  it('offers Publish for an unpublished draft that has not happened yet', () => {
    expect(canOfferPublish({ is_published: false, status: 'draft', start_datetime: '2027-02-01T00:00:00Z' }, NOW)).toBe(true)
    expect(canOfferPublish({ is_published: false, status: 'draft' }, NOW)).toBe(true)
    // A Firestore Timestamp-like value.
    expect(canOfferPublish({ is_published: false, status: 'draft', end_datetime: { toDate: () => new Date('2027-03-01T00:00:00Z') } }, NOW)).toBe(true)
  })

  it('not for live, cancelled, completed, rejected or past events', () => {
    expect(canOfferPublish({ is_published: true, status: 'published' }, NOW)).toBe(false)
    expect(canOfferPublish({ is_published: false, status: 'cancelled' }, NOW)).toBe(false)
    expect(canOfferPublish({ is_published: false, status: 'completed' }, NOW)).toBe(false)
    expect(canOfferPublish({ is_published: false, status: 'rejected' }, NOW)).toBe(false)
    expect(canOfferPublish({ is_published: false, status: 'draft', end_datetime: '2026-12-01T00:00:00Z' }, NOW)).toBe(false)
    expect(canOfferPublish(null, NOW)).toBe(false)
  })

  it('points each publish-route refusal at its fix', () => {
    for (const c of ['verification_required', 'stripe_connect_required', 'stripe_onboarding_incomplete', 'stripe_account_unavailable', 'payout_country_mismatch']) {
      expect(publishFixFor(c)).toBe('payouts')
    }
    expect(publishFixFor('tier_price_below_minimum')).toBe('edit')
    expect(publishFixFor('stripe_unreachable')).toBeNull()
    expect(publishFixFor('event_cancelled')).toBeNull()
    expect(publishFixFor(undefined)).toBeNull()
  })
})
