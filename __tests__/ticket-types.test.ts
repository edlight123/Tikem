import { TIER_SETS, isUntouchedDraft, tierNameFor, tierSetLabel } from '@/lib/ticketTypes'
import * as app from '../mobile/lib/ticketTypes'

describe('ready-made ticket types', () => {
  it('offers the Tikem sets', () => {
    expect(TIER_SETS.map((s) => tierSetLabel(s, 'en'))).toEqual([
      'General · VIP',
      'General · VIP · Table',
      'Early bird · General · Door',
      'Students · General',
      'Adults · Children',
    ])
  })

  it('names every type in English, French and Kreyòl', () => {
    for (const set of TIER_SETS)
      for (const n of set.names) for (const l of ['en', 'fr', 'ht']) expect(tierNameFor(n, l).trim()).not.toBe('')
    expect(tierSetLabel(TIER_SETS[2], 'ht')).toBe('Prevant · Jeneral · Nan pòt la')
    expect(tierSetLabel(TIER_SETS[4], 'fr')).toBe('Adultes · Enfants')
    expect(tierNameFor(TIER_SETS[0].names[0], 'de')).toBe('General')
  })

  it('treats a single unnamed or default tier as a fresh draft', () => {
    expect(isUntouchedDraft([{ name: '' }])).toBe(true)
    expect(isUntouchedDraft([{ name: 'General Admission' }])).toBe(true)
  })

  it('never replaces named, saved or multiple tiers', () => {
    expect(isUntouchedDraft([{ name: 'VIP' }])).toBe(false)
    expect(isUntouchedDraft([{ name: '', docId: 'abc' }])).toBe(false)
    expect(isUntouchedDraft([{ name: '', id: 'abc' }], 'id')).toBe(false)
    expect(isUntouchedDraft([{ name: '' }, { name: '' }])).toBe(false)
  })

  it('the app offers exactly the same sets', () => {
    expect(app.TIER_SETS).toEqual(TIER_SETS)
    for (const set of TIER_SETS) for (const l of ['en', 'fr', 'ht']) expect(app.tierSetLabel(set, l)).toBe(tierSetLabel(set, l))
    expect(app.isUntouchedDraft([{ name: '' }])).toBe(isUntouchedDraft([{ name: '' }]))
  })
})
