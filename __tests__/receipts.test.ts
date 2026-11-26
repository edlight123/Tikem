/**
 * @jest-environment node
 *
 * Buyer receipts (lib/receipts): totals, links, who counts as the buyer, and
 * the printable page. Adapted from Tikra's tests to Tikèm (no charity number,
 * fee tax or legal-entity block; HTG has no decimals; Haiti receipts are French).
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { buildReceipt, formatMinor, orderNumber, receiptKey, receiptPath, renderReceiptHtml, verifyReceiptKey } from '@/lib/receipts/receipt'
import { receiptBuyerIds } from '@/lib/receipts/receipt-server'
import { receiptLangFor } from '@/lib/receipts/labels'

const ticket = (o: Record<string, any> = {}) => ({
  id: 't1',
  payment_id: 'pi_123',
  status: 'valid',
  tier_name: 'General',
  charged_amount: 1500,
  charged_currency: 'HTG',
  payment_method: 'moncash',
  ...o,
})

describe('buildReceipt', () => {
  it('groups tickets by tier and totals what was charged', () => {
    const r = buildReceipt({
      paymentId: 'pi_123',
      tickets: [ticket(), ticket({ id: 't2' })],
      event: { title: 'Kompa Night', country: 'HT' },
      organizerName: 'Kompa Co',
    })!
    expect(r.totalMinor).toBeGreaterThan(0)
    expect(r.lines.reduce((n, l) => n + l.quantity, 0)).toBe(2)
    expect(r.currency).toBe('HTG')
  })

  it('has no receipt for free or door-paid tickets', () => {
    expect(buildReceipt({ paymentId: 'x', tickets: [ticket({ charged_amount: 0, price_paid: 0 })], event: null, organizerName: null })).toBeNull()
    expect(buildReceipt({ paymentId: 'x', tickets: [ticket({ payment_method: 'pay_at_door' })], event: null, organizerName: null })).toBeNull()
  })

  it('order numbers drop the Stripe prefix', () => {
    expect(orderNumber('pi_3AbCdEf')).not.toMatch(/^pi_/)
  })
})

describe('money', () => {
  it('HTG shows no decimals', () => {
    expect(formatMinor(150000, 'HTG', 'fr')).not.toMatch(/[.,]00/)
  })
})

describe('language', () => {
  it('a Haiti event receipt is French whatever was asked', () => {
    expect(receiptLangFor({ country: 'HT' }, 'en')).toBe('fr')
    expect(receiptLangFor({ country: 'US' }, 'en')).toBe('en')
  })
})

describe('who is the buyer', () => {
  it('takes the account ids on the order, never a transferee', () => {
    const ids = receiptBuyerIds([
      { attendee_id: 'buyer', user_id: 'buyer' },
      { attendee_id: 'friend', user_id: 'friend', transfer_count: 1 }, // set by /api/tickets/transfer/respond
    ])
    expect(ids).toContain('buyer')
    expect(ids).not.toContain('friend')
  })
})

describe('receipt links', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('only the right key, order and expiry open a receipt', () => {
    process.env.RECEIPT_LINK_SECRET = 'a-test-secret-long-enough'
    const now = Date.now()
    const exp = now + 60_000
    const k = receiptKey('pi_123', exp)
    expect(verifyReceiptKey('pi_123', k, exp, now)).toBe(true)
    expect(verifyReceiptKey('pi_999', k, exp, now)).toBe(false)
    expect(verifyReceiptKey('pi_123', k, exp + 1, now)).toBe(false)
    expect(verifyReceiptKey('pi_123', k, exp, exp + 1)).toBe(false)
    expect(verifyReceiptKey('pi_123', 'nope', exp, now)).toBe(false)
  })

  it('fails closed when no secret is configured', () => {
    delete process.env.RECEIPT_LINK_SECRET
    delete process.env.GUEST_TICKET_LINK_SECRET
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    expect(verifyReceiptKey('pi_123', 'anything', Date.now() + 1000)).toBe(false)
    expect(() => receiptPath('pi_123', { signed: true })).toThrow()
  })
})

describe('renderReceiptHtml', () => {
  it('escapes what organizers and buyers typed', () => {
    const r = buildReceipt({
      paymentId: 'pi_123',
      tickets: [ticket({ tier_name: '<img src=x onerror=alert(1)>' })],
      event: { title: '<script>x</script>', country: 'US' },
      organizerName: '<b>Org</b>',
    })!
    const html = renderReceiptHtml(r, 'en')
    expect(html).not.toContain('<script>x</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })
})
