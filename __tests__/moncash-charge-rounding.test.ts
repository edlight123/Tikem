/**
 * The MonCash charge amount is summed from per-tier unit prices that have each
 * already been rounded to 2 decimals. Floating point reintroduces drift on that
 * sum, and the raw Number is what gets POSTed to Digicel's CreatePayment — so a
 * 7-ticket order could ask the gateway to collect 27325.690000000002 HTG.
 */
import { sumMoney } from '@/lib/fx/usd-htg'

describe('sumMoney', () => {
  it('does not leak float drift into the gateway amount', () => {
    // 7 x 3903.67 is 27325.690000000002 when summed naively.
    expect(sumMoney([3903.67, 3903.67, 3903.67, 3903.67, 3903.67, 3903.67, 3903.67])).toBe(27325.69)
  })

  it('handles a multi-tier order', () => {
    // 2 x 7470.07 + 7 x 8534.71 + 8 x 7588.42 drifts low by a hair.
    const parts = [
      ...Array(2).fill(7470.07),
      ...Array(7).fill(8534.71),
      ...Array(8).fill(7588.42),
    ]
    expect(sumMoney(parts)).toBe(135390.47)
  })

  it('leaves an exact total alone', () => {
    expect(sumMoney([50])).toBe(50)
    expect(sumMoney([1500, 1500])).toBe(3000)
  })

  it('is 0 for an empty order rather than NaN', () => {
    expect(sumMoney([])).toBe(0)
  })
})
