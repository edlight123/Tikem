/**
 * The Expo app duplicates the tier reconcile (it is a separate bundle and
 * cannot import lib/tickets/tier-reconcile.ts). If the two drift, one composer
 * goes back to wiping sold counts or orphaning tickets while the other doesn't.
 *
 * So: the source must be identical, and the same scenarios must produce the
 * same plans. If this fails, copy lib/tickets/tier-reconcile.ts over
 * mobile/lib/tierReconcile.ts — the web file is the source of truth.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as web from '@/lib/tickets/tier-reconcile'
import * as mobile from '../mobile/lib/tierReconcile'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('tier reconcile parity (web vs mobile)', () => {
  it('ships byte-identical source', () => {
    expect(read('mobile/lib/tierReconcile.ts')).toBe(read('lib/tickets/tier-reconcile.ts'))
  })

  const existing = [
    { id: 'a', name: 'GA', sort_order: 0, sold_quantity: 12 },
    { id: 'b', name: 'VIP', sort_order: 1, sold_quantity: 0 },
    { id: 'c', name: 'Old', sort_order: 2, sold_quantity: 4, archived: true },
    { id: 'd', name: 'Table', sort_order: 3, sold_quantity: 2 },
  ]
  const scenarios = [
    [{ id: 'a', name: 'GA', quantity: 5, fields: 1 }, { id: null, name: 'New', quantity: 10, fields: 2 }],
    [{ id: 'b', name: 'VIP', quantity: 30, fields: 1 }],
    [],
    [{ id: 'c', name: 'Old', quantity: 1, fields: 1 }, { id: 'a', name: 'GA', quantity: 1, fields: 2 }],
  ]

  it.each(scenarios.map((s, i) => [i, s] as const))('planTierSync scenario %i', (_i, desired) => {
    expect(mobile.planTierSync(existing, desired as any)).toEqual(web.planTierSync(existing, desired as any))
  })

  it('matchSiblingTierIds, resolveOrphan and the quantity floor agree', () => {
    const desired = [{ id: 'a', name: 'Renamed' }, { id: 'b', name: 'VIP' }, { id: null, name: 'table' }]
    const sibling = [
      { id: 'x', name: 'GA', sort_order: 0 },
      { id: 'y', name: 'Other', sort_order: 1 },
      { id: 'z', name: 'Table', sort_order: 2 },
    ]
    expect(mobile.matchSiblingTierIds(desired, existing, sibling)).toEqual(
      web.matchSiblingTierIds(desired, existing, sibling)
    )
    for (const [sold, tix] of [[0, 0], [0, 1], [1, 0]]) {
      expect(mobile.resolveOrphan(sold, tix)).toBe(web.resolveOrphan(sold, tix))
    }
    for (const [q, s, u] of [[5, 10, false], [10, 10, false], [5, 10, true]] as const) {
      expect(mobile.isQuantityBelowSold(q, s, u)).toBe(web.isQuantityBelowSold(q, s, u))
      expect(mobile.clampTierQuantity(q, s)).toBe(web.clampTierQuantity(q, s))
    }
  })
})
