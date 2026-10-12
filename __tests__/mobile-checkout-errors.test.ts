import { classifyCheckoutError, friendlyCheckoutError, looksInternal } from '../mobile/lib/checkoutErrors'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

/** Minimal stand-in for the app's `t`: echoes the key and any params. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}|${JSON.stringify(params)}` : key

/** What backendJson throws: server message + the request URL, plus code/status/payload. */
function backendError(payload: any, status: number) {
  const err: any = new Error(`${payload?.error || 'Request failed'} [https://www.tikem.co/api/create-payment-intent]`)
  err.code = payload?.code
  err.status = status
  err.payload = payload
  return err
}

describe('mobile checkout error sanitizing', () => {
  it('maps "no trustworthy FX rate" to localized copy, not the server sentence', () => {
    const err = backendError({ error: 'whatever the server said', code: 'fx_rate_unavailable' }, 503)
    expect(classifyCheckoutError(err)).toBe('fx_unavailable')
    expect(friendlyCheckoutError(err, t, 'paymentModal.errors.moncashFailed')).toBe('paymentModal.errors.fxUnavailable')
    for (const dict of [en, fr, ht] as any[]) {
      expect(typeof dict.paymentModal.errors.fxUnavailable).toBe('string')
      expect(dict.paymentModal.moncashQuote.rateDetail).toMatch(/\{rate\}.*\{spread\}/)
    }
  })

  it('maps the typed organizer code to localized copy (the build-39 screenshot)', () => {
    const err = backendError(
      { error: "This organizer can't accept card payments yet.", code: 'organizer_payments_unavailable' },
      409
    )
    expect(classifyCheckoutError(err)).toBe('organizer_unavailable')
    expect(friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed')).toBe(
      'paymentModal.errors.organizerCardUnavailable'
    )
  })

  it('offers the alternative method by name when there is one', () => {
    const err = backendError({ code: 'organizer_payments_unavailable' }, 409)
    expect(
      friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed', { alternativeMethodName: 'MonCash' })
    ).toBe('paymentModal.errors.organizerCardUnavailableTryOther|{"method":"MonCash"}')
  })

  it('still recognises the old server code and the raw Stripe wording', () => {
    expect(classifyCheckoutError({ code: 'organizer_payouts_unavailable' })).toBe('organizer_unavailable')
    expect(classifyCheckoutError(backendError({ error: "No such destination: 'acct_1SfytLC6CSO7g3zh'" }, 500))).toBe(
      'organizer_unavailable'
    )
  })

  it('never renders an account id, URL or internal path', () => {
    const err = backendError({ error: "Something about acct_1SfytLC6CSO7g3zh" }, 400)
    const shown = friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed')
    expect(shown).toBe('paymentModal.errors.paymentFailed')
    expect(shown).not.toMatch(/acct_|https?:|\/api\//)
  })

  it('shows the server’s own clean 4xx copy, without the URL suffix', () => {
    const err = backendError({ error: 'Only 2 ticket(s) remaining for this tier.' }, 400)
    expect(friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed')).toBe(
      'Only 2 ticket(s) remaining for this tier.'
    )
  })

  it('does not trust a 5xx message', () => {
    const err = backendError({ error: 'We could not start this payment.' }, 500)
    expect(friendlyCheckoutError(err, t, 'paymentModal.errors.paymentFailed')).toBe('paymentModal.errors.paymentFailed')
  })

  it('uses a Stripe SDK localizedMessage when it is clean', () => {
    const sheetError = { code: 'Failed', message: 'x', localizedMessage: 'Your card has insufficient funds.' }
    expect(friendlyCheckoutError(sheetError, t, 'paymentModal.errors.paymentFailed')).toBe(
      'Your card has insufficient funds.'
    )
  })

  it('maps network failures and declines', () => {
    expect(friendlyCheckoutError(new Error('Network request failed: unable to reach API (https://tikem.co). Verify EXPO_PUBLIC_API_URL'), t, 'x')).toBe(
      'paymentModal.errors.network'
    )
    expect(friendlyCheckoutError({ code: 'card_declined' }, t, 'x')).toBe('paymentModal.errors.cardDeclined')
  })

  it('flags internal-looking text', () => {
    expect(looksInternal('pi_3Nabc123_secret_xyz')).toBe(true)
    expect(looksInternal('Missing Stripe publishable key. Please configure EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.')).toBe(true)
    expect(looksInternal('This ticket tier is sold out.')).toBe(false)
  })
})

describe('mobile checkout copy exists in all three languages', () => {
  const keys = [
    'paymentModal.errors.organizerCardUnavailable',
    'paymentModal.errors.organizerCardUnavailableTryOther',
    'paymentModal.errors.cardDeclined',
    'paymentModal.errors.network',
    'paymentModal.methods.cardUnavailable',
    'paymentModal.stripeMissingKey',
    'ticketSelector.noTiers',
    'ticketSelector.noTiersHint',
  ]
  const get = (dict: any, key: string) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict)

  for (const [lang, dict] of Object.entries({ en, fr, ht })) {
    it(`${lang} defines every key, with no env var names shown to buyers`, () => {
      for (const key of keys) {
        const value = get(dict, key)
        expect(typeof value).toBe('string')
        expect(value).not.toMatch(/EXPO_PUBLIC_|STRIPE_/)
      }
      expect(get(dict, 'paymentModal.errors.organizerCardUnavailableTryOther')).toContain('{method}')
    })
  }
})

describe('seat-hold refusals at checkout start', () => {
  it('maps sold_out / only_n_left / busy_try_again to localized copy', () => {
    expect(friendlyCheckoutError(backendError({ code: 'sold_out', remaining: 0 }, 409), t, 'x')).toBe(
      'paymentModal.errors.soldOut'
    )
    expect(friendlyCheckoutError(backendError({ code: 'only_n_left', remaining: 2 }, 409), t, 'x')).toBe(
      'paymentModal.errors.onlyNLeft|{"count":2}'
    )
    expect(friendlyCheckoutError(backendError({ code: 'busy_try_again' }, 503), t, 'x')).toBe(
      'paymentModal.errors.busyTryAgain'
    )
    for (const dict of [en, fr, ht] as any[]) {
      expect(typeof dict.paymentModal.errors.soldOut).toBe('string')
      expect(dict.paymentModal.errors.onlyNLeft).toContain('{count}')
      expect(typeof dict.paymentModal.errors.busyTryAgain).toBe('string')
    }
  })
})
