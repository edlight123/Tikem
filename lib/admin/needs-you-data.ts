/**
 * Reads the Needs You landing rows from Firestore.
 *
 * Uses the same equality-only shape as queue-summary.ts, and for the same
 * reasons: the ordered form needs composite indexes that mostly do not exist,
 * and — verified against live data — 8 of 11 verification_requests documents
 * carry only `created_at` while others carry `createdAt`, so ordering by any
 * single field name makes Firestore silently drop most of the queue.
 *
 * THE SUBJECT REQUIRES A JOIN. Verified against live data: verification_requests
 * documents contain no name and no email — only `userId` (or `user_id`; both
 * spellings exist). Reading the subject straight off the document produced
 * "Unknown organizer" for all 11 real rows. The human name lives in `users`, so
 * rows that identify a person are resolved in one batched getAll after the
 * queues are read, the same way app/api/admin/events/list does it.
 *
 * A queue that fails returns [] rather than throwing: one cold index must not
 * empty the whole landing.
 */

import { adminDb } from '@/lib/firebase/admin'
import { docAge } from '@/lib/admin/queue-summary'
import { mergeNeedsYou, type NeedsYouItem } from '@/lib/admin/needs-you'
import type { QueueKey } from '@/lib/admin/queue-keys'

/** Cap per queue: the landing is a triage list, not a full backlog export. */
const PER_QUEUE = 25

/** A row before its subject has been resolved. */
interface RawRow {
  id: string
  queue: QueueKey
  decision: string
  href: string
  createdAt: string | null
  /** Subject taken straight from the document, when the document has one. */
  subject: string | null
  /** When set, the subject comes from this user's profile instead. */
  userId: string | null
}

interface QueueSpec {
  queue: QueueKey
  build: () => FirebaseFirestore.Query
  ageField: string
  decision: (data: any) => string
  href: string
  /** Subject from the document itself. Return null to fall back to the user join. */
  subject?: (data: any) => string | null
  /** The user whose name identifies this row, if any. */
  userId?: (data: any, doc: FirebaseFirestore.QueryDocumentSnapshot) => string | null
}

/** First non-empty string among the candidate keys. */
function firstString(data: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = data?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const QUEUE_SPECS: QueueSpec[] = [
  {
    queue: 'verifications',
    build: () =>
      adminDb
        .collection('verification_requests')
        .where('status', 'in', ['pending_review', 'in_review', 'pending']),
    ageField: 'createdAt',
    decision: () => 'ID verification',
    href: '/admin/trust',
    // These documents carry no name — resolved from `users` below.
    subject: (d) => firstString(d, ['businessName', 'full_name', 'email']),
    userId: (d) => firstString(d, ['userId', 'user_id']),
  },
  {
    queue: 'bankVerifications',
    build: () =>
      adminDb
        .collectionGroup('verificationDocuments')
        .where('type', '==', 'bank')
        .where('status', '==', 'pending'),
    ageField: 'submittedAt',
    decision: () => 'bank verification',
    href: '/admin/trust/bank',
    subject: (d) => firstString(d, ['accountName', 'bankName']),
    // These live at organizers/{organizerId}/verificationDocuments/{id}.
    userId: (_d, doc) => doc.ref.parent.parent?.id ?? null,
  },
  {
    queue: 'payoutReview',
    build: () => adminDb.collection('payout_review_queue').where('status', '==', 'pending'),
    ageField: 'createdAt',
    decision: () => 'payout review',
    href: '/admin/money',
    subject: (d) => firstString(d, ['organizerName', 'organizer_name']),
    userId: (d) => firstString(d, ['organizerId', 'organizer_id']),
  },
  {
    queue: 'disbursements',
    build: () => adminDb.collectionGroup('payouts').where('status', 'in', ['pending', 'approved']),
    ageField: 'createdAt',
    decision: () => 'disbursement',
    href: '/admin/money/disbursements',
    subject: (d) => firstString(d, ['organizerName', 'organizer_name']),
    userId: (d, doc) => firstString(d, ['organizerId', 'organizer_id']) ?? doc.ref.parent.parent?.id ?? null,
  },
  {
    queue: 'withdrawals',
    build: () => adminDb.collection('withdrawal_requests').where('status', '==', 'pending'),
    ageField: 'createdAt',
    decision: () => 'withdrawal',
    href: '/admin/money/withdrawals',
    subject: (d) => firstString(d, ['organizerName', 'organizer_name']),
    userId: (d) => firstString(d, ['organizerId', 'organizer_id']),
  },
  {
    queue: 'disputes',
    build: () => adminDb.collection('disputes').where('status', '==', 'open'),
    // Disputes have no createdAt; stripeCreatedAt/firstSeenAt are the real
    // opening timestamps, and updatedAt moves on every Stripe webhook.
    ageField: 'stripeCreatedAt',
    decision: () => 'dispute',
    href: '/admin/money/disputes',
    subject: (d) => firstString(d, ['subject', 'reason', 'orderId', 'chargeId']),
    userId: (d) => firstString(d, ['organizerId', 'organizer_id']),
  },
  {
    queue: 'pendingEvents',
    build: () => adminDb.collection('events').where('is_published', '==', false).where('rejected', '==', false),
    ageField: 'created_at',
    decision: () => 'event approval',
    href: '/admin/events',
    subject: (d) => firstString(d, ['title']) ?? 'Untitled event',
  },
  {
    queue: 'reportedEvents',
    build: () => adminDb.collection('events').where('reports_count', '>', 0),
    ageField: 'created_at',
    decision: (d) => `reported ×${d?.reports_count ?? 1}`,
    href: '/admin/events?tab=reported',
    subject: (d) => firstString(d, ['title']) ?? 'Untitled event',
  },
]

async function readQueue(spec: QueueSpec): Promise<RawRow[]> {
  try {
    const snap = await spec.build().limit(PER_QUEUE).get()
    return (snap.docs as FirebaseFirestore.QueryDocumentSnapshot[]).map((doc) => {
      const data = doc.data() || {}
      return {
        id: doc.id,
        queue: spec.queue,
        decision: spec.decision(data),
        href: spec.href,
        createdAt: docAge(data, spec.ageField),
        subject: spec.subject ? spec.subject(data) : null,
        userId: spec.userId ? spec.userId(data, doc) : null,
      }
    })
  } catch (error) {
    console.warn(`[admin/needs-you] ${spec.queue} read failed`, error)
    return []
  }
}

/**
 * Names for the rows that identify a person. One batched getAll rather than a
 * read per row; missing users come back with `exists === false` and simply keep
 * their fallback label.
 */
async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (userIds.length === 0) return names

  try {
    const refs = userIds.map((id) => adminDb.collection('users').doc(id))
    const docs = await adminDb.getAll(...refs)
    for (const doc of docs as any[]) {
      if (!doc.exists) continue
      const data = doc.data() || {}
      const name = firstString(data, ['full_name', 'name', 'businessName', 'email'])
      if (name) names.set(doc.id, name)
    }
  } catch (error) {
    console.warn('[admin/needs-you] user name resolution failed', error)
  }

  return names
}

export async function getNeedsYouItems(): Promise<NeedsYouItem[]> {
  const groups = await Promise.all(QUEUE_SPECS.map(readQueue))
  const rows = groups.flat()

  // Only look up users for rows that still need a name.
  const pendingIds = Array.from(
    new Set(rows.filter((r) => !r.subject && r.userId).map((r) => r.userId as string))
  )
  const names = await resolveUserNames(pendingIds)

  const items: NeedsYouItem[] = rows.map((row) => ({
    id: row.id,
    queue: row.queue,
    subject:
      row.subject ??
      (row.userId ? names.get(row.userId) : null) ??
      // Last resort: a truncated id still beats "Unknown", which tells an admin
      // nothing and looks identical on every row.
      (row.userId ? `User ${row.userId.slice(0, 8)}` : 'Unidentified request'),
    decision: row.decision,
    href: row.href,
    createdAt: row.createdAt,
  }))

  return mergeNeedsYou([items])
}
