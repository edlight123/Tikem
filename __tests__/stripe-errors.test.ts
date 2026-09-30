import { friendlyStripeError } from '@/lib/checkout/stripe-errors'

describe('friendlyStripeError', () => {
  it('turns a stale Connect destination into something a buyer can act on', () => {
    // The exact error a tester hit on build 39: an organizer account issued by
    // the previous platform, rendered verbatim in the app with the id visible.
    const error = new Error("No such destination: 'acct_1SfytLC6CSO7g3zh'")
    const friendly = friendlyStripeError(error)

    expect(friendly.code).toBe('organizer_payments_unavailable')
    expect(friendly.status).toBe(409) // not a 500: nothing is broken on our side
    expect(friendly.message).not.toMatch(/acct_/)
    expect(friendly.message).toMatch(/organizer/i)
  })

  it('matches the same failure however Stripe words it', () => {
    for (const error of [
      { raw: { message: "No such account: 'acct_123'" } },
      { raw: { code: 'account_invalid' } },
      { raw: { param: 'transfer_data[destination]' } },
    ]) {
      expect(friendlyStripeError(error).code).toBe('organizer_payments_unavailable')
    }
  })

  it('never leaks an account id through the generic path', () => {
    const error = new Error("Something odd about acct_1SfytLC6CSO7g3zh happened")
    const friendly = friendlyStripeError(error)
    expect(friendly.message).not.toMatch(/acct_/)
    expect(friendly.code).toBe('payment_failed')
  })

  it('passes a card decline through, because that IS the buyer’s business', () => {
    const error = { type: 'StripeCardError', code: 'card_declined', message: 'Your card was declined.' }
    const friendly = friendlyStripeError(error)
    expect(friendly.status).toBe(402)
    expect(friendly.message).toBe('Your card was declined.')
  })

  it('explains an amount that cannot be charged', () => {
    expect(friendlyStripeError({ raw: { code: 'amount_too_small' } }).code).toBe('amount_too_small')
    expect(friendlyStripeError({ raw: { code: 'amount_too_large' } }).code).toBe('amount_too_large')
  })

  it('handles a thrown non-error without crashing', () => {
    expect(friendlyStripeError(undefined).code).toBe('payment_failed')
    expect(friendlyStripeError('boom').code).toBe('payment_failed')
  })
})
