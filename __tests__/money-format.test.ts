/**
 * One money format on the website and in the app (owner, 2026-11-25: "for HTG
 * remove .00"): whole gourdes have no decimals, dollars and euros keep cents.
 */
import { formatMoney, formatMoneyFromCents } from '@/lib/money'
import { formatCurrency } from '../mobile/lib/currency'

describe('formatMoney', () => {
  it.each([
    [1500, 'HTG', '1,500 HTG'],
    [16000, 'HTG', '16,000 HTG'],
    [1234.5, 'HTG', '1,234.50 HTG'],
    [59.29, 'USD', '$59.29'],
    [60, 'USD', '$60.00'],
    [12.5, 'CAD', 'CA$12.50'],
    [5, 'EUR', '€5.00'],
  ])('%s %s -> %s, the same as the app', (amount, currency, expected) => {
    expect(formatMoney(amount as number, currency as string)).toBe(expected)
    expect(formatCurrency(amount as number, currency as string)).toBe(expected)
  })

  it('formatMoneyFromCents drops .00 for whole gourdes only', () => {
    expect(formatMoneyFromCents(150000, 'HTG').replace(/\s/g, ' ')).toBe('HTG 1,500')
    expect(formatMoneyFromCents(5929, 'USD')).toBe('$59.29')
  })
})
