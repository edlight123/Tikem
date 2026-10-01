/**
 * Editing an event used to REPLACE its whole tier set: every doc deleted, new
 * ones inserted with sold_quantity 0. Sold counts reset (so checkout, which
 * reads total - sold, could oversell) and every ticket's tier_id pointed at a
 * deleted doc. These cases pin the in-place reconcile that replaced it.
 */
import {
  planTierSync,
  matchSiblingTierIds,
  resolveOrphan,
  clampTierQuantity,
  isQuantityBelowSold,
  soldQuantityOf,
  isLiveTier,
  type ExistingTier,
} from '@/lib/tickets/tier-reconcile'

const row = (id: string | null, name: string, quantity: number) => ({
  id,
  name,
  quantity,
  fields: { name },
})

describe('planTierSync', () => {
  const existing: ExistingTier[] = [
    { id: 'ga', name: 'GA', sort_order: 0, sold_quantity: 40 },
    { id: 'vip', name: 'VIP', sort_order: 1, sold_quantity: 0 },
  ]

  it('updates tiers in place and never touches the sold count', () => {
    const plan = planTierSync(existing, [row('ga', 'General', 100), row('vip', 'VIP', 20)])
    expect(plan.inserts).toEqual([])
    expect(plan.orphans).toEqual([])
    expect(plan.updates).toEqual([
      { id: 'ga', sortOrder: 0, fields: { name: 'General' }, soldQuantity: 40, totalQuantity: 100, available: 60 },
      { id: 'vip', sortOrder: 1, fields: { name: 'VIP' }, soldQuantity: 0, totalQuantity: 20, available: 20 },
    ])
  })

  it('inserts a row without an id, and a row whose id is unknown', () => {
    const plan = planTierSync(existing, [row('ga', 'GA', 100), row('vip', 'VIP', 20), row(null, 'Table', 5), row('gone', 'X', 1)])
    expect(plan.inserts.map((i) => [i.sortOrder, i.fields.name, i.totalQuantity])).toEqual([
      [2, 'Table', 5],
      [3, 'X', 1],
    ])
  })

  it('deactivates a removed tier that sold, and asks for a ticket check on one that did not', () => {
    const plan = planTierSync(existing, [row(null, 'New', 10)])
    expect(plan.updates).toEqual([])
    expect(plan.orphans).toEqual([
      { id: 'ga', soldQuantity: 40, action: 'deactivate' },
      { id: 'vip', soldQuantity: 0, action: 'check_tickets' },
    ])
  })

  it('clamps a quantity below what is already sold', () => {
    const plan = planTierSync(existing, [row('ga', 'GA', 10), row('vip', 'VIP', 20)])
    expect(plan.updates[0]).toMatchObject({ totalQuantity: 40, available: 0 })
  })

  it('a duplicated id only claims its doc once; the second row is inserted', () => {
    const plan = planTierSync(existing, [row('ga', 'GA', 100), row('ga', 'GA copy', 100), row('vip', 'VIP', 1)])
    expect(plan.updates.map((u) => u.id)).toEqual(['ga', 'vip'])
    expect(plan.inserts.map((i) => i.fields.name)).toEqual(['GA copy'])
  })

  it('leaves archived docs alone: not matched, not orphaned again', () => {
    const plan = planTierSync(
      [...existing, { id: 'old', name: 'Early bird', sold_quantity: 12, archived: true }],
      [row('ga', 'GA', 100), row('vip', 'VIP', 20), row('old', 'Early bird', 5)]
    )
    expect(plan.orphans).toEqual([])
    expect(plan.updates.map((u) => u.id)).toEqual(['ga', 'vip'])
    expect(plan.inserts.map((i) => i.fields.name)).toEqual(['Early bird'])
  })

  it('an RSVP / empty editor orphans every live tier', () => {
    expect(planTierSync(existing, []).orphans.map((o) => o.id)).toEqual(['ga', 'vip'])
  })
})

describe('resolveOrphan', () => {
  it('deletes only a tier with no sales and no tickets', () => {
    expect(resolveOrphan(0, 0)).toBe('delete')
    expect(resolveOrphan(3, 0)).toBe('deactivate')
    // The old bug reset counters to 0 while tickets still carried the tier_id.
    expect(resolveOrphan(0, 1)).toBe('deactivate')
  })
})

describe('quantity floor', () => {
  it('clampTierQuantity never goes below sold', () => {
    expect(clampTierQuantity(5, 10)).toBe(10)
    expect(clampTierQuantity(50, 10)).toBe(50)
    expect(clampTierQuantity(NaN, 0)).toBe(0)
  })
  it('isQuantityBelowSold ignores unlimited and unsold tiers', () => {
    expect(isQuantityBelowSold(5, 10)).toBe(true)
    expect(isQuantityBelowSold(10, 10)).toBe(false)
    expect(isQuantityBelowSold(5, 10, true)).toBe(false)
    expect(isQuantityBelowSold(0, 0)).toBe(false)
  })
  it('soldQuantityOf tolerates junk', () => {
    expect(soldQuantityOf({ sold_quantity: '7' })).toBe(7)
    expect(soldQuantityOf({ sold_quantity: -2 })).toBe(0)
    expect(soldQuantityOf({})).toBe(0)
    expect(soldQuantityOf(null)).toBe(0)
  })
  it('isLiveTier', () => {
    expect(isLiveTier({ archived: true })).toBe(false)
    expect(isLiveTier({})).toBe(true)
  })
})

describe('matchSiblingTierIds', () => {
  const source: ExistingTier[] = [
    { id: 's-ga', name: 'GA', sort_order: 0 },
    { id: 's-vip', name: 'VIP', sort_order: 1 },
  ]
  const sibling: ExistingTier[] = [
    { id: 'b-vip', name: 'VIP', sort_order: 1, sold_quantity: 3 },
    { id: 'b-ga', name: 'GA', sort_order: 0, sold_quantity: 9 },
  ]

  it('matches by the source tier ORIGINAL name, so a rename still lands', () => {
    expect(
      matchSiblingTierIds([row('s-ga', 'General Admission', 1), row('s-vip', 'VIP', 1)], source, sibling)
    ).toEqual(['b-ga', 'b-vip'])
  })

  it('falls back to sort_order when the sibling tier was renamed', () => {
    const sib = [{ id: 'b0', name: 'Entry', sort_order: 0 }, { id: 'b1', name: 'Gold', sort_order: 1 }]
    expect(matchSiblingTierIds([row('s-ga', 'GA', 1), row('s-vip', 'VIP', 1)], source, sib)).toEqual(['b0', 'b1'])
  })

  it('a new row matches a same-named sibling tier, else inserts', () => {
    const sib = [...sibling, { id: 'b-table', name: 'Table', sort_order: 2 }]
    expect(
      matchSiblingTierIds([row('s-ga', 'GA', 1), row(null, 'table ', 1), row(null, 'Balcony', 1)], source, sib)
    ).toEqual(['b-ga', 'b-table', null])
  })

  it('claims each sibling tier once and skips archived ones', () => {
    const sib = [{ id: 'b-ga', name: 'GA', sort_order: 0 }, { id: 'b-old', name: 'VIP', sort_order: 1, archived: true }]
    expect(matchSiblingTierIds([row('s-ga', 'GA', 1), row('s-vip', 'GA', 1)], source, sib)).toEqual(['b-ga', null])
  })

  it('feeds planTierSync so each sibling keeps its own sold counts', () => {
    const desired = [row('s-ga', 'GA', 100), row('s-vip', 'VIP', 2)]
    const ids = matchSiblingTierIds(desired, source, sibling)
    const plan = planTierSync(sibling, desired.map((d, i) => ({ ...d, id: ids[i] })))
    expect(plan.updates.map((u) => [u.id, u.soldQuantity, u.totalQuantity])).toEqual([
      ['b-ga', 9, 100],
      ['b-vip', 3, 3],
    ])
    expect(plan.orphans).toEqual([])
  })
})
