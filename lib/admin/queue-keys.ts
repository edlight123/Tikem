/**
 * The admin queue taxonomy: which queues exist, how they collapse into rail
 * entries, and how a rail entry's figure is derived.
 *
 * Deliberately free of imports. The Firestore reader lives in queue-summary.ts,
 * which re-exports everything here — keeping the pure half separate is what lets
 * it be unit-tested and what lets client components (the sidebar) use the
 * taxonomy without pulling firebase-admin into the browser bundle.
 */

export const QUEUE_KEYS = [
  'verifications',
  'bankVerifications',
  'payoutReview',
  'disbursements',
  'withdrawals',
  'disputes',
  'pendingEvents',
  'reportedEvents',
  // Community shares and event claims (lib/community, /admin/community).
  'communityShares',
  'eventClaims',
] as const

export type QueueKey = (typeof QUEUE_KEYS)[number]

/** null means the read FAILED. {count: 0} means the queue is CLEAR. Not the same. */
export type QueueStat = { count: number; oldestAt: string | null } | null

export type QueueSummary = Record<QueueKey, QueueStat>

export interface RailGroup {
  key: 'verifications' | 'payouts' | 'reported' | 'disputes' | 'community'
  label: string
  href: string
  sources: QueueKey[]
}

/**
 * The eight sources collapse to four rail entries: bank verifications and
 * organizer verifications are one job to an admin, as are withdrawals and
 * payouts.
 */
export const RAIL_GROUPS: RailGroup[] = [
  {
    key: 'verifications',
    label: 'Verifications',
    href: '/admin/trust',
    sources: ['verifications', 'bankVerifications'],
  },
  {
    key: 'payouts',
    label: 'Payouts',
    href: '/admin/money',
    sources: ['payoutReview', 'disbursements', 'withdrawals'],
  },
  { key: 'reported', label: 'Reported', href: '/admin/events', sources: ['reportedEvents', 'pendingEvents'] },
  { key: 'disputes', label: 'Disputes', href: '/admin/money/disputes', sources: ['disputes'] },
  { key: 'community', label: 'Community', href: '/admin/community', sources: ['communityShares', 'eventClaims'] },
]

/**
 * A rail entry's figure: counts sum, and the age is the OLDEST across sources so
 * the entry never under-reports how far behind it is. Null only when every
 * source failed — one readable source is still worth showing.
 */
export function railStat(summary: QueueSummary, group: RailGroup): QueueStat {
  const stats = group.sources.map((k) => summary[k]).filter((s): s is NonNullable<QueueStat> => s !== null)
  if (stats.length === 0) return null

  let count = 0
  let oldestAt: string | null = null
  for (const s of stats) {
    count += s.count
    if (s.oldestAt && (oldestAt === null || s.oldestAt < oldestAt)) oldestAt = s.oldestAt
  }
  return { count, oldestAt }
}
