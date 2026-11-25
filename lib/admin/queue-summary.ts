/**
 * Per-queue "how many, and how long has the oldest been waiting" for the admin
 * sidebar and the Needs You landing.
 *
 * WHY THERE IS NO orderBy HERE
 * ----------------------------
 * The obvious implementation — `where(...).orderBy(ageField,'asc').limit(1)` —
 * was tried first and fails on seven of the eight queues: each needs a composite
 * index that does not exist in firestore.indexes.json. Worse, the per-queue
 * catch below would have swallowed those failures, so the rail would have shown
 * "—" everywhere while looking like a working feature.
 *
 * Two further problems ruled that approach out even with indexes added:
 *
 *   1. Field naming is not consistent. `verification_requests` documents carry
 *      `createdAt`, `submittedAt` AND `created_at`. Firestore DROPS documents
 *      missing the ordered field, so ordering by any single name silently hides
 *      real work.
 *   2. Four of these collections (payout_review_queue, payouts,
 *      withdrawal_requests, disputes) are empty outside production, so the right
 *      field name for them cannot be confirmed from a dev environment at all.
 *
 * So: the count comes from an equality-only aggregation (no composite index
 * needed — this is how the existing counts in lib/firestore/admin.ts work), and
 * the oldest timestamp is computed in memory over an equality-only page,
 * coalescing across the candidate age-field names. That is exact whenever the
 * queue fits in one page, which is the normal case for pending work.
 *
 * Every source still degrades on its own: null means the read FAILED, {count: 0}
 * means the queue is CLEAR, and the sidebar renders those differently.
 */

import { adminDb } from '@/lib/firebase/admin'
import type { QueueStat, QueueSummary } from '@/lib/admin/queue-keys'

// The taxonomy lives in queue-keys.ts (no imports, so it is testable and safe in
// client bundles). Re-exported here so server callers have one import site.
export {
  QUEUE_KEYS,
  RAIL_GROUPS,
  railStat,
  type QueueKey,
  type QueueStat,
  type QueueSummary,
  type RailGroup,
} from '@/lib/admin/queue-keys'

/**
 * How many documents a queue's oldest-scan reads. Above this the age becomes a
 * lower bound rather than exact — acceptable for a "am I behind" signal, and the
 * count stays exact regardless because it comes from an aggregation.
 */
const OLDEST_SCAN = 100

/**
 * Candidate age fields, most specific first. Collections in this codebase were
 * written at different times with different conventions; a document is dated by
 * whichever of these it actually carries.
 */
const AGE_FIELDS = ['createdAt', 'submittedAt', 'created_at', 'submitted_at', 'updatedAt', 'updated_at']

function toIso(value: any): string | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    const d = value.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/** The document's age, from whichever candidate field it carries. */
export function docAge(data: any, preferred?: string): string | null {
  if (!data) return null
  const fields = preferred ? [preferred, ...AGE_FIELDS] : AGE_FIELDS
  for (const field of fields) {
    const iso = toIso(data[field])
    if (iso) return iso
  }
  return null
}

/**
 * A queue's figures from equality-only reads: an exact count, and the oldest
 * timestamp across a bounded page.
 *
 * `preferredAgeField` is a hint, not a filter — a document missing it still
 * counts, dated by whatever it does carry.
 */
async function statFor(build: () => FirebaseFirestore.Query, preferredAgeField?: string): Promise<QueueStat> {
  try {
    const [countSnap, pageSnap] = await Promise.all([
      build().count().get(),
      build().limit(OLDEST_SCAN).get(),
    ])

    let oldestAt: string | null = null
    for (const doc of pageSnap.docs as any[]) {
      const iso = docAge(doc.data(), preferredAgeField)
      if (iso && (oldestAt === null || iso < oldestAt)) oldestAt = iso
    }

    return { count: countSnap.data().count || 0, oldestAt }
  } catch (error) {
    console.warn('[admin/queue-summary] queue read failed', error)
    return null
  }
}

/**
 * Every queue's figures. Runs the sources concurrently; a rejection in one
 * cannot reject the whole summary because statFor already catches.
 */
export async function getQueueSummary(): Promise<QueueSummary> {
  const [
    verifications,
    bankVerifications,
    payoutReview,
    disbursements,
    withdrawals,
    disputes,
    pendingEvents,
    reportedEvents,
    communityShares,
    eventClaims,
    accountMerges,
  ] = await Promise.all([
    statFor(
      () =>
        adminDb
          .collection('verification_requests')
          .where('status', 'in', ['pending_review', 'in_review', 'pending']),
      'createdAt'
    ),
    statFor(
      () =>
        adminDb
          .collectionGroup('verificationDocuments')
          .where('type', '==', 'bank')
          .where('status', '==', 'pending'),
      'submittedAt'
    ),
    statFor(() => adminDb.collection('payout_review_queue').where('status', '==', 'pending'), 'createdAt'),
    statFor(
      () => adminDb.collectionGroup('payouts').where('status', 'in', ['pending', 'approved']),
      'createdAt'
    ),
    statFor(() => adminDb.collection('withdrawal_requests').where('status', '==', 'pending'), 'createdAt'),
    statFor(() => adminDb.collection('disputes').where('status', '==', 'open'), 'updatedAt'),
    statFor(
      () => adminDb.collection('events').where('is_published', '==', false).where('rejected', '==', false),
      'created_at'
    ),
    // reports_count > 0 is a range filter; keeping it equality-free of any
    // orderBy keeps it on the same index-free footing as the rest.
    statFor(() => adminDb.collection('events').where('reports_count', '>', 0), 'created_at'),
    statFor(() => adminDb.collection('event_submissions').where('status', '==', 'pending'), 'created_at'),
    statFor(() => adminDb.collection('event_claims').where('status', '==', 'pending'), 'created_at'),
    statFor(() => adminDb.collection('account_merge_reviews').where('status', '==', 'pending'), 'created_at'),
  ])

  return {
    verifications,
    bankVerifications,
    payoutReview,
    disbursements,
    withdrawals,
    disputes,
    pendingEvents,
    reportedEvents,
    communityShares,
    eventClaims,
    accountMerges,
  }
}
