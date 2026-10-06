/**
 * MonCash Button payment flow tests
 *
 * These tests exercise the money- and security-critical pieces of the MonCash Button
 * checkout that powers Haiti payments (lib/moncash-button.ts), which is consumed by:
 *   - POST /api/moncash-button/initiate   (create order + redirect)
 *   - GET  /api/moncash-button/checkout   (RSA-encrypted auto-submit form)
 *   - GET  /api/moncash-button/return     (verify payment, then issue tickets)
 *   - POST /api/moncash-button/alert      (server-to-server correlation)
 *
 * What we verify here without hitting Digicel's servers:
 *   1. Configuration gating (so a misconfigured deploy can't silently accept money).
 *   2. Redirect URL construction for sandbox vs production.
 *   3. The RSA encrypt (checkout) <-> decrypt (return) round-trip. This is the core
 *      contract with the gateway: the orderId/amount we encrypt must be recoverable.
 *   4. REST checkout-token creation (success / transient retry / hard failure).
 *   5. Payment verification, including the EXACT gate the Return handler uses before
 *      creating tickets: isPaid = payment.success && payment.payment_status.
 */

import crypto from 'crypto'

import {
  isMonCashButtonConfigured,
  getMonCashButtonRedirectUrl,
  createMonCashButtonCheckoutFormPost,
  encryptToMonCashButtonBase64,
  decryptMonCashButtonReturnTransactionId,
  getMonCashButtonReturnDecryptConfig,
  createMonCashButtonCheckoutToken,
  getMonCashButtonPaymentByOrderId,
  getMonCashButtonPaymentByTransactionId,
  isMonCashButtonPaidAmountAcceptable,
} from '@/lib/moncash-button'

// One RSA keypair acts as the test "merchant" credentials.
// The public key plays the role of Digicel's "Secret API KEY" (used to encrypt),
// the private key plays the role of the key used to decrypt the ReturnUrl transactionId.
const { publicKey: TEST_PUBLIC_KEY_PEM, privateKey: TEST_PRIVATE_KEY_PEM } =
  crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

// 18 chars, not a multiple of 4 -> not treated as base64, so it stays a single
// path segment which keeps fetch-mock assertions deterministic.
const BUSINESS_KEY = 'TESTBUSINESSKEY123'

const SANDBOX_MIDDLEWARE = 'https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware'
const PRODUCTION_MIDDLEWARE = 'https://moncashbutton.digicelgroup.com/Moncash-middleware'

function clearMonCashEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MONCASH_')) delete process.env[key]
  }
}

function setConfiguredEnv() {
  process.env.MONCASH_BUTTON_MODE = 'sandbox'
  // Pin padding + encoding so the REST/lookup helpers make a single deterministic attempt.
  process.env.MONCASH_BUTTON_RSA_PADDING = 'pkcs1'
  process.env.MONCASH_BUTTON_CIPHERTEXT_ENCODING = 'base64'
  process.env.MONCASH_BUTTON_BUSINESS_KEY = BUSINESS_KEY
  process.env.MONCASH_BUTTON_SECRET_API_KEY = TEST_PUBLIC_KEY_PEM
  process.env.MONCASH_BUTTON_PRIVATE_KEY = TEST_PRIVATE_KEY_PEM
}

describe('MonCash Button payment flow', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    clearMonCashEnv()
    setConfiguredEnv()
    // Keep test output clean; the helper logs diagnostics on failures/retries.
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  afterAll(() => {
    clearMonCashEnv()
  })

  // --------------------------------------------------------------------------
  describe('isMonCashButtonConfigured()', () => {
    it('returns true when primary business + secret keys are set', () => {
      expect(isMonCashButtonConfigured()).toBe(true)
    })

    it('returns false when configuration is missing', () => {
      clearMonCashEnv()
      expect(isMonCashButtonConfigured()).toBe(false)
    })

    it('returns false when only the business key is set (no secret)', () => {
      clearMonCashEnv()
      process.env.MONCASH_BUTTON_BUSINESS_KEY = BUSINESS_KEY
      expect(isMonCashButtonConfigured()).toBe(false)
    })

    it('returns true when only FORM credentials are present', () => {
      clearMonCashEnv()
      process.env.MONCASH_BUTTON_FORM_BUSINESS_KEY = BUSINESS_KEY
      process.env.MONCASH_BUTTON_FORM_SECRET_API_KEY = TEST_PUBLIC_KEY_PEM
      expect(isMonCashButtonConfigured()).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  describe('getMonCashButtonRedirectUrl()', () => {
    it('builds a sandbox redirect URL', () => {
      process.env.MONCASH_BUTTON_MODE = 'sandbox'
      expect(getMonCashButtonRedirectUrl('tok_123')).toBe(
        `${SANDBOX_MIDDLEWARE}/Checkout/Payment/Redirect/tok_123`
      )
    })

    it('builds a production redirect URL', () => {
      process.env.MONCASH_BUTTON_MODE = 'production'
      const url = getMonCashButtonRedirectUrl('tok_123')
      expect(url).toBe(`${PRODUCTION_MIDDLEWARE}/Checkout/Payment/Redirect/tok_123`)
      expect(url).not.toContain('sandbox')
    })
  })

  // --------------------------------------------------------------------------
  describe('Checkout encryption <-> Return decryption round-trip', () => {
    it('round-trips the orderId through encrypt (form) then decrypt (return)', () => {
      const orderId = '123456789'
      const { fields, actionUrl, meta } = createMonCashButtonCheckoutFormPost({
        amount: 500,
        orderId,
      })

      // Form posts to the middleware Checkout endpoint scoped by the business key.
      expect(actionUrl).toBe(`${SANDBOX_MIDDLEWARE}/Checkout/${BUSINESS_KEY}`)

      // Ciphertext fields must be present and must NOT leak plaintext.
      expect(fields.orderId).toBeTruthy()
      expect(fields.amount).toBeTruthy()
      expect(fields.orderId).not.toContain(orderId)

      // Default form encoding is base64url (URL/form safe: no '+' '/' or padding).
      expect(meta.ciphertextEncoding).toBe('base64url')
      expect(fields.orderId).toMatch(/^[A-Za-z0-9_-]+$/)

      // Digicel MonCash Button examples use RSA/None/NoPadding for the form.
      expect(meta.paddingMode).toBe('none')

      // The Return handler must be able to recover the exact orderId.
      expect(decryptMonCashButtonReturnTransactionId(fields.orderId)).toBe(orderId)
    })

    it('round-trips the amount and formats whole HTG without decimals', () => {
      const { fields, meta } = createMonCashButtonCheckoutFormPost({
        amount: 1500,
        orderId: '987654321',
      })
      expect(meta.amountPlaintext).toBe('1500')
      expect(decryptMonCashButtonReturnTransactionId(fields.amount)).toBe('1500')
    })

    it('round-trips via encryptToMonCashButtonBase64 (REST padding/encoding)', () => {
      const value = '424242424'
      const encrypted = encryptToMonCashButtonBase64(value)
      expect(encrypted).not.toContain(value)
      expect(decryptMonCashButtonReturnTransactionId(encrypted)).toBe(value)
    })

    it('reports that a private key is available for decryption', () => {
      const cfg = getMonCashButtonReturnDecryptConfig()
      expect(cfg.hasPrimaryPrivateKey).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  describe('decryptMonCashButtonReturnTransactionId() edge cases', () => {
    it('returns null for empty input', () => {
      expect(decryptMonCashButtonReturnTransactionId('')).toBeNull()
    })

    it('returns null for undecryptable garbage (and never throws)', () => {
      const garbage = crypto.randomBytes(32).toString('base64')
      expect(decryptMonCashButtonReturnTransactionId(garbage)).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  describe('createMonCashButtonCheckoutToken()', () => {
    it('returns the token and posts to the REST checkout endpoint on success', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, token: 'tok_success' }),
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const { token } = await createMonCashButtonCheckoutToken({ amount: 500, orderId: '123456789' })

      expect(token).toBe('tok_success')
      expect(fetchMock).toHaveBeenCalled()
      const [calledUrl, calledInit] = fetchMock.mock.calls[0]
      expect(calledUrl).toBe(`${SANDBOX_MIDDLEWARE}/Checkout/Rest/${BUSINESS_KEY}`)
      expect(calledInit.method).toBe('POST')
      // Body carries encrypted amount + orderId (never plaintext).
      expect(calledInit.body).toContain('amount=')
      expect(calledInit.body).toContain('orderId=')
      expect(calledInit.body).not.toContain('123456789')
    })

    it('retries past a transient gateway "system error" and still returns a token', async () => {
      // Allow multiple padding/encoding combinations so a retry attempt is possible.
      delete process.env.MONCASH_BUTTON_RSA_PADDING
      delete process.env.MONCASH_BUTTON_CIPHERTEXT_ENCODING

      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'System Error' })
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, token: 'tok_retry' }),
        })
      global.fetch = fetchMock as unknown as typeof fetch

      const { token } = await createMonCashButtonCheckoutToken({ amount: 500, orderId: '123456789' })
      expect(token).toBe('tok_retry')
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('throws a descriptive error when the gateway never returns a token', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ success: false, message: 'nope' }),
      })
      global.fetch = fetchMock as unknown as typeof fetch

      await expect(
        createMonCashButtonCheckoutToken({ amount: 500, orderId: '123456789' })
      ).rejects.toThrow(/MonCash Button token request failed/)
    })
  })

  // --------------------------------------------------------------------------
  describe('getMonCashButtonPaymentByOrderId() — the ticket-issuing gate', () => {
    it('never verifies against the sandbox in production, and never probes the other mode', async () => {
      const prevVercel = process.env.VERCEL_ENV
      process.env.VERCEL_ENV = 'production'
      try {
        // A sandbox-pinned config is refused outright: no gateway call at all.
        const sandboxFetch = jest.fn()
        global.fetch = sandboxFetch as unknown as typeof fetch
        await expect(getMonCashButtonPaymentByOrderId('123456789')).rejects.toThrow(/sandbox/i)
        expect(sandboxFetch).not.toHaveBeenCalled()

        // Production mode, unpaid on production: the sandbox is not asked.
        delete process.env.MONCASH_BUTTON_MODE
        process.env.MONCASH_MODE = 'production'
        const prodFetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: false, message: 'not found' }),
        })
        global.fetch = prodFetch as unknown as typeof fetch
        await getMonCashButtonPaymentByOrderId('123456789').catch(() => null)
        for (const [url] of prodFetch.mock.calls) expect(String(url)).not.toMatch(/sandbox/i)
      } finally {
        if (prevVercel === undefined) delete process.env.VERCEL_ENV
        else process.env.VERCEL_ENV = prevVercel
      }
    })

    it('treats a confirmed order as PAID (success && payment_status)', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            payment_status: true,
            reference: '123456789',
            transNumber: 'TX123',
            payer: '50912345678',
            cost: 500,
          }),
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const payment = await getMonCashButtonPaymentByOrderId('123456789')

      expect(payment.success).toBe(true)
      expect(payment.payment_status).toBe(true)
      expect(payment.reference).toBe('123456789')
      expect(payment.transNumber).toBe('TX123')

      // EXACT gate used by app/api/moncash-button/return/route.ts before issuing tickets.
      const isPaid = !!(payment.success && payment.payment_status)
      expect(isPaid).toBe(true)

      const [calledUrl] = fetchMock.mock.calls[0]
      expect(calledUrl).toBe(`${SANDBOX_MIDDLEWARE}/Checkout/${BUSINESS_KEY}/Payment/Order/`)
    })

    it('does NOT treat an unpaid order as paid (payment_status=false)', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ success: true, payment_status: false, reference: '123456789' }),
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const payment = await getMonCashButtonPaymentByOrderId('123456789')

      const isPaid = !!(payment.success && payment.payment_status)
      expect(isPaid).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  describe('getMonCashButtonPaymentByTransactionId() — orderId correlation', () => {
    it('resolves the order reference from a transaction id', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            payment_status: true,
            reference: '123456789',
            transNumber: 'TX999',
          }),
      })
      global.fetch = fetchMock as unknown as typeof fetch

      const payment = await getMonCashButtonPaymentByTransactionId('opaque-trans-id')
      expect(payment.reference).toBe('123456789')

      const [calledUrl] = fetchMock.mock.calls[0]
      expect(calledUrl).toBe(`${SANDBOX_MIDDLEWARE}/Checkout/${BUSINESS_KEY}/Payment/Transaction/`)
    })
  })

  // --------------------------------------------------------------------------
  // Defense-in-depth: the Return handler must refuse to issue tickets when the
  // gateway-reported amount doesn't match what we asked it to charge.
  describe('isMonCashButtonPaidAmountAcceptable() — amount guard', () => {
    it('accepts an exact match and reports it as verified', () => {
      const result = isMonCashButtonPaidAmountAcceptable(1500, 1500)
      expect(result).toMatchObject({ ok: true, verified: true, expected: 1500, paid: 1500 })
    })

    it('accepts a whole-HTG rounded amount within tolerance', () => {
      // Gateway formats whole HTG; a 0.5 HTG rounding delta must not block fulfillment.
      const result = isMonCashButtonPaidAmountAcceptable(1499.5, '1500')
      expect(result.ok).toBe(true)
      expect(result.verified).toBe(true)
    })

    it('accepts a string cost from the gateway', () => {
      expect(isMonCashButtonPaidAmountAcceptable(500, '500').ok).toBe(true)
    })

    it('REJECTS gross underpayment (verified mismatch)', () => {
      const result = isMonCashButtonPaidAmountAcceptable(1500, 1)
      expect(result.verified).toBe(true)
      expect(result.ok).toBe(false)
    })

    it('REJECTS overpayment beyond tolerance', () => {
      const result = isMonCashButtonPaidAmountAcceptable(1500, 5000)
      expect(result.verified).toBe(true)
      expect(result.ok).toBe(false)
    })

    it('does not verify (but does not block) when cost is missing', () => {
      for (const missing of [undefined, null, ''] as const) {
        const result = isMonCashButtonPaidAmountAcceptable(1500, missing)
        expect(result.verified).toBe(false)
        expect(result.ok).toBe(true)
        expect(result.paid).toBeNull()
      }
    })

    it('does not verify when the expected amount is non-positive/invalid', () => {
      expect(isMonCashButtonPaidAmountAcceptable(0, 100)).toMatchObject({ ok: true, verified: false })
      expect(isMonCashButtonPaidAmountAcceptable(NaN, 100)).toMatchObject({ ok: true, verified: false })
    })

    it('mirrors the Return handler gate: only a verified mismatch blocks fulfillment', () => {
      // verified && !ok  -> block; otherwise proceed.
      const shouldBlock = (expected: number, cost: string | number | null | undefined) => {
        const c = isMonCashButtonPaidAmountAcceptable(expected, cost)
        return c.verified && !c.ok
      }
      expect(shouldBlock(1500, 1500)).toBe(false) // exact -> proceed
      expect(shouldBlock(1500, 1)).toBe(true) // mismatch -> block
      expect(shouldBlock(1500, undefined)).toBe(false) // unknown -> proceed
    })
  })
})
