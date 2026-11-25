import { describe, it, expect } from '@jest/globals'
import { QUEUE_KEYS, RAIL_GROUPS, railStat } from '../lib/admin/queue-keys'
import type { QueueSummary } from '../lib/admin/queue-keys'

const empty = (): QueueSummary =>
  Object.fromEntries(QUEUE_KEYS.map((k) => [k, { count: 0, oldestAt: null }])) as QueueSummary

describe('QUEUE_KEYS', () => {
  it('covers all the queue sources from the spec', () => {
    expect([...QUEUE_KEYS].sort()).toEqual(
      [
        'bankVerifications',
        'disbursements',
        'disputes',
        'pendingEvents',
        'payoutReview',
        'reportedEvents',
        'verifications',
        'withdrawals',
        'communityShares',
        'eventClaims',
        'accountMerges',
      ].sort()
    )
  })
})

describe('RAIL_GROUPS', () => {
  it('collapses the sources into the four rail entries', () => {
    expect(RAIL_GROUPS.map((g) => g.key)).toEqual(['verifications', 'payouts', 'reported', 'disputes', 'community'])
  })
  it('folds bank verifications into Verifications and withdrawals into Payouts', () => {
    const byKey = Object.fromEntries(RAIL_GROUPS.map((g) => [g.key, g.sources]))
    expect(byKey.verifications).toContain('bankVerifications')
    expect(byKey.payouts).toContain('withdrawals')
  })
  it('assigns every source to exactly one rail group', () => {
    const assigned = RAIL_GROUPS.flatMap((g) => g.sources)
    expect([...assigned].sort()).toEqual([...QUEUE_KEYS].sort())
    expect(new Set(assigned).size).toBe(assigned.length)
  })
})

describe('railStat', () => {
  it('sums counts across the group sources', () => {
    const s = empty()
    s.verifications = { count: 9, oldestAt: '2026-08-14T10:00:00.000Z' }
    s.bankVerifications = { count: 3, oldestAt: '2026-08-14T11:00:00.000Z' }
    expect(railStat(s, RAIL_GROUPS[0])!.count).toBe(12)
  })

  it('takes the OLDEST timestamp so a rail entry never under-reports', () => {
    const s = empty()
    s.verifications = { count: 1, oldestAt: '2026-08-14T11:00:00.000Z' }
    s.bankVerifications = { count: 1, oldestAt: '2026-08-08T09:00:00.000Z' }
    expect(railStat(s, RAIL_GROUPS[0])!.oldestAt).toBe('2026-08-08T09:00:00.000Z')
  })

  it('returns null when EVERY source failed to read', () => {
    const s = empty()
    s.verifications = null
    s.bankVerifications = null
    s.accountMerges = null
    expect(railStat(s, RAIL_GROUPS[0])).toBeNull()
  })

  it('still reports the readable source when only one failed', () => {
    const s = empty()
    s.verifications = { count: 4, oldestAt: '2026-08-10T09:00:00.000Z' }
    s.bankVerifications = null
    expect(railStat(s, RAIL_GROUPS[0])).toEqual({ count: 4, oldestAt: '2026-08-10T09:00:00.000Z' })
  })

  it('distinguishes an empty queue from an unreadable one', () => {
    const s = empty()
    expect(railStat(s, RAIL_GROUPS[3])).toEqual({ count: 0, oldestAt: null })
    s.disputes = null
    expect(railStat(s, RAIL_GROUPS[3])).toBeNull()
  })
})
