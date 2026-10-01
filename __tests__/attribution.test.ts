/**
 * Visit attribution helpers (lib/attribution.ts) and their mobile mirror.
 *
 * @jest-environment node
 */

import {
  attributionFromSearchParams,
  attributionFromStripeMetadata,
  attributionToStripeMetadata,
  buildTrackingUrl,
  clickDedupeKey,
  conversionRate,
  createIpRateLimiter,
  formatConversion,
  isLikelyBot,
  sanitizeAttribution,
  shouldSendClick,
  ticketAttributionFields,
  withResolvedPromoter,
  CLICK_DEDUPE_WINDOW_MS,
} from '@/lib/attribution'
import * as mobile from '../mobile/lib/attribution'

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}), { virtual: true })

const LINK_ID = 'AbCdEfGhIjKlMnOpQrSt'

describe('sanitizeAttribution', () => {
  it('keeps well-formed fields and drops junk', () => {
    expect(
      sanitizeAttribution({
        t: LINK_ID,
        utm_source: '  instagram ',
        utm_medium: 'story\u0000',
        utm_campaign: 'x'.repeat(300),
        ref: 'steeve',
      })
    ).toEqual({
      tracking_link_id: LINK_ID,
      utm_source: 'instagram',
      utm_medium: 'story',
      utm_campaign: 'x'.repeat(100),
      promoter_ref: 'STEEVE',
    })
  })

  it('rejects a malformed tracking link id and returns null when nothing is left', () => {
    expect(sanitizeAttribution({ t: '../../etc', ref: '!' })).toBeNull()
    expect(sanitizeAttribution(null)).toBeNull()
    expect(sanitizeAttribution('t=abc')).toBeNull()
  })

  it('reads the event-page query string', () => {
    const a = attributionFromSearchParams(
      new URLSearchParams(`utm_source=whatsapp&utm_medium=group&t=${LINK_ID}`)
    )
    expect(a).toMatchObject({ tracking_link_id: LINK_ID, utm_source: 'whatsapp', utm_medium: 'group' })
    expect(attributionFromSearchParams(new URLSearchParams('foo=bar'))).toBeNull()
  })

  it('the server-resolved promoter code wins over the client ref', () => {
    const a = sanitizeAttribution({ utm_source: 'ig', ref: 'FAKE' })
    expect(withResolvedPromoter(a, 'REAL')?.promoter_ref).toBe('REAL')
    expect(withResolvedPromoter(null, 'REAL')).toMatchObject({ promoter_ref: 'REAL', tracking_link_id: null })
    expect(withResolvedPromoter(null, null)).toBeNull()
  })
})

describe('attribution through PaymentIntent metadata', () => {
  it('round-trips into the ticket stamp, using the resolved promoter code', () => {
    const order = withResolvedPromoter(
      sanitizeAttribution({ t: LINK_ID, utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'launch' }),
      'STEEVE'
    )
    // What create-payment-intent puts on the PI (Stripe metadata is string-only).
    const metadata = { eventId: 'evt1', promoterCode: 'STEEVE', ...attributionToStripeMetadata(order) }
    for (const v of Object.values(metadata)) expect(typeof v).toBe('string')

    // What the webhook / create-from-payment read back and stamp on each ticket.
    expect(ticketAttributionFields(attributionFromStripeMetadata(metadata))).toEqual({
      attribution: {
        tracking_link_id: LINK_ID,
        utm_source: 'instagram',
        utm_medium: 'story',
        utm_campaign: 'launch',
        promoter_ref: 'STEEVE',
      },
    })
  })

  it('an unattributed PaymentIntent stamps nothing', () => {
    const metadata = { eventId: 'evt1', promoterCode: '', ...attributionToStripeMetadata(null) }
    expect(ticketAttributionFields(attributionFromStripeMetadata(metadata))).toEqual({})
  })
})

describe('click dedupe', () => {
  it('keys by link id, else by event + promoter ref', () => {
    expect(clickDedupeKey('evt1', { t: LINK_ID, ref: 'STEEVE' })).toBe(`t_${LINK_ID}`)
    expect(clickDedupeKey('evt-1', { ref: 'steeve' })).toBe('r_evt1_STEEVE')
    expect(clickDedupeKey('evt1', {})).toBeNull()
  })

  it('sends once per 30-minute window', () => {
    const now = 1_000_000_000
    expect(shouldSendClick(null, now)).toBe(true)
    expect(shouldSendClick(now - 60_000, now)).toBe(false)
    expect(shouldSendClick(now - CLICK_DEDUPE_WINDOW_MS + 1, now)).toBe(false)
    expect(shouldSendClick(now - CLICK_DEDUPE_WINDOW_MS, now)).toBe(true)
    // A clock that went backwards must not suppress clicks forever.
    expect(shouldSendClick(now + 10_000, now)).toBe(true)
  })

  it('mobile mirror agrees with the web', () => {
    const now = 5_000_000
    for (const last of [null, now - 1000, now - CLICK_DEDUPE_WINDOW_MS, now + 5]) {
      expect(mobile.shouldSendClick(last, now)).toBe(shouldSendClick(last, now))
    }
    expect(mobile.clickDedupeKey('evt-1', { tracking_link_id: null, promoter_ref: 'steeve' })).toBe(
      clickDedupeKey('evt-1', { ref: 'steeve' })
    )
    expect(mobile.attributionFromParams({ t: LINK_ID, utm_source: ' ig ', ref: 'x1' })).toEqual(
      sanitizeAttribution({ t: LINK_ID, utm_source: ' ig ', ref: 'x1' })
    )
    expect(mobile.formatConversion(3, 40)).toBe(formatConversion(3, 40))
  })
})

describe('bot filter', () => {
  it.each([
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    '',
  ])('ignores %p', (ua) => {
    expect(isLikelyBot(ua)).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-A146U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0',
    // The app's own fetch on Android and iOS.
    'okhttp/4.9.2',
    'Tikem/44 CFNetwork/1494.0.7 Darwin/23.4.0',
  ])('counts %p', (ua) => {
    expect(isLikelyBot(ua)).toBe(false)
  })
})

describe('IP rate limiter', () => {
  it('allows `limit` hits per window per IP, then throttles until the window rolls', () => {
    const limiter = createIpRateLimiter({ limit: 3, windowMs: 60_000 })
    const t0 = 1_000
    expect([1, 2, 3].map(() => limiter.hit('1.2.3.4', t0))).toEqual([false, false, false])
    expect(limiter.hit('1.2.3.4', t0 + 10)).toBe(true)
    // Other addresses are unaffected.
    expect(limiter.hit('5.6.7.8', t0 + 10)).toBe(false)
    // New window.
    expect(limiter.hit('1.2.3.4', t0 + 60_000)).toBe(false)
  })
})

describe('conversion + link building', () => {
  it('orders over clicks, capped, null without clicks', () => {
    expect(conversionRate(5, 0)).toBeNull()
    expect(conversionRate(5, 50)).toBeCloseTo(0.1)
    expect(conversionRate(9, 3)).toBe(1)
    expect(formatConversion(1, 0)).toBe('—')
    expect(formatConversion(1, 200)).toBe('0.5%')
    expect(formatConversion(3, 12)).toBe('25%')
  })

  it('puts the t= id after the utm params', () => {
    expect(
      buildTrackingUrl('https://www.tikem.co/events/e1', { source: 'ig', medium: 'story', campaign: '', id: LINK_ID })
    ).toBe(`https://www.tikem.co/events/e1?utm_source=ig&utm_medium=story&t=${LINK_ID}`)
  })
})
