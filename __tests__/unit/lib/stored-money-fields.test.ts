import { withStoredMoneyFields } from '@/lib/events/stored-money-fields'

const form = { title: 'x', country: 'HT', currency: 'HTG' }

describe('composer edit keeps the money-defining fields of the stored event', () => {
  it('never relabels the stored country (US/CA events were stamped HT)', () => {
    expect(withStoredMoneyFields(form, { country: 'US', currency: 'USD' }).country).toBe('US')
  })
  it('leaves a missing stored country out of the payload instead of writing HT', () => {
    expect('country' in withStoredMoneyFields(form, { currency: 'HTG' })).toBe(false)
  })
  it('a sold event keeps its stored currency, exactly as stored (even lower-case / missing)', () => {
    expect(withStoredMoneyFields({ ...form, currency: 'USD' }, { country: 'HT', currency: 'htg', tickets_sold: 3 }).currency).toBe('htg')
    expect('currency' in withStoredMoneyFields(form, { country: 'HT', tickets_sold: 1 })).toBe(false)
  })
  it('before any sale the organizer may change currency, normalised for the stored country', () => {
    expect(withStoredMoneyFields({ ...form, currency: 'usd' }, { country: 'HT', currency: 'HTG', tickets_sold: 0 }).currency).toBe('USD')
    expect(withStoredMoneyFields({ ...form, currency: 'HTG' }, { country: 'US', currency: 'USD' }).currency).toBe('USD')
  })
})
