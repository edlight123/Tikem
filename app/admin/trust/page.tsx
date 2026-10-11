import AdminVerifyClient from './AdminVerifyClient'
import { TRUST_TABS } from './tabs'
import { ConsoleCaption, ConsolePage, ConsoleTabs } from '@/components/admin/console'
import { adminDb } from '@/lib/firebase/admin'

export const revalidate = 0
export const dynamic = 'force-dynamic'

function serializeFirestoreValue(value: any): any {
  if (value == null) return value

  // Firestore Timestamp (admin/client SDK) and other objects that expose toDate()
  if (typeof value?.toDate === 'function') {
    try {
      const date = value.toDate()
      if (date instanceof Date) return date.toISOString()
    } catch {
      // fall through
    }
  }

  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeFirestoreValue)

  if (typeof value === 'object') {
    const output: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      output[key] = serializeFirestoreValue(val)
    }
    return output
  }

  return value
}

export default async function AdminVerifyPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams?: Promise<{ status?: string }>
}) {
  const requestedStatusRaw = ((await searchParams)?.status || 'pending').toLowerCase()

  // Support both legacy and canonical statuses.
  // in_progress is a draft: not submitted, not approvable (review-verification).
  const pendingStatuses = ['pending_review', 'in_review', 'pending']
  const supported = new Set(['pending', 'approved', 'rejected', 'changes_requested', 'in_progress', 'all'])
  const requestedStatus = supported.has(requestedStatusRaw) ? requestedStatusRaw : 'pending'

  // Fetch a bounded set of verification requests (avoid scanning the entire collection).
  let verificationRequests: any[] = []
  try {
    const mapDoc = (doc: any) => {
      const data = doc.data()
      const serialized = serializeFirestoreValue(data)

      const normalizedUserId =
        serialized?.userId || serialized?.user_id || serialized?.userID || serialized?.uid || doc.id

      // Preserve the actual status from DB - don't default to 'pending'
      const actualStatus = serialized?.status || 'unknown'

      return {
        id: doc.id,
        ...serialized,
        userId: normalizedUserId,
        user_id: serialized?.user_id ?? serialized?.userId ?? null,
        status: actualStatus,
      }
    }

    // Build query based on requested status
    let snapshot: any
    
    if (requestedStatus === 'pending') {
      // submittedAt is what submit-verification writes (nothing writes submitted_at)
      try {
        snapshot = await adminDb.collection('verification_requests')
          .where('status', 'in', pendingStatuses)
          .orderBy('submittedAt', 'desc')
          .limit(50)
          .get()
      } catch (e1) {
        console.log('[verify/page] Failed with submittedAt order, trying without order:', e1)
        // Fallback: query without ordering if index doesn't exist
        snapshot = await adminDb.collection('verification_requests')
          .where('status', 'in', pendingStatuses)
          .limit(50)
          .get()
      }
    } else if (requestedStatus !== 'all') {
      try {
        snapshot = await adminDb.collection('verification_requests')
          .where('status', '==', requestedStatus)
          .orderBy('submittedAt', 'desc')
          .limit(50)
          .get()
      } catch (e2) {
        snapshot = await adminDb.collection('verification_requests')
          .where('status', '==', requestedStatus)
          .limit(50)
          .get()
      }
    } else {
      // 'all' status - just get recent ones
      try {
        snapshot = await adminDb.collection('verification_requests')
          .orderBy('submittedAt', 'desc')
          .limit(50)
          .get()
      } catch (e3) {
        snapshot = await adminDb.collection('verification_requests')
          .limit(50)
          .get()
      }
    }

    const primary = snapshot.docs.map(mapDoc)
    
    // Log what we got for debugging
    console.log(`[verify/page] Fetched ${primary.length} requests for status='${requestedStatus}'`)
    const statusBreakdown = primary.reduce((acc: any, r: any) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {})
    console.log(`[verify/page] Status breakdown:`, statusBreakdown)

    // If pending queue looks suspiciously small, add a bounded fallback query to catch
    // older/mismatched docs that still have submission timestamps but an unexpected status.
    if (requestedStatus === 'pending' && primary.length < 10) {
      const byId = new Map<string, any>(primary.map((r: any) => [String(r.id), r]))

      const isPendingLike = (r: any) => {
        const s = String(r?.status || '').toLowerCase()
        // Only include items with explicit pending-like statuses
        // Do NOT include items with changes_requested, rejected, or approved
        if (s === 'changes_requested' || s === 'rejected' || s === 'approved') return false
        if (pendingStatuses.includes(s)) return true
        return false
      }

      const tryFallbackOrder = async (field: string) => {
        const snap = await adminDb.collection('verification_requests').orderBy(field, 'desc').limit(50).get()
        return snap.docs.map(mapDoc)
      }

      let fallback: any[] = []
      try {
        fallback = await tryFallbackOrder('submittedAt')
      } catch {
        try {
          fallback = await tryFallbackOrder('submitted_at')
        } catch {
          try {
            fallback = await tryFallbackOrder('createdAt')
          } catch {
            try {
              fallback = await tryFallbackOrder('created_at')
            } catch {
              fallback = []
            }
          }
        }
      }

      for (const r of fallback) {
        if (byId.has(String(r.id))) continue
        if (!isPendingLike(r)) continue
        byId.set(String(r.id), r)
      }

      verificationRequests = Array.from(byId.values()).slice(0, 50)
    } else {
      verificationRequests = primary
    }
  } catch (err) {
    console.error('Error fetching verification requests:', err)
    verificationRequests = []
  }

  // Batch-load related users (Firestore `in` supports max 10 ids per query).
  const userIds = Array.from(
    new Set(
      verificationRequests
        .map((r: any) => String(r.userId || r.user_id || r.id || '').trim())
        .filter(Boolean)
    )
  )

  const usersById = new Map<string, any>()
  try {
    // Resolve users by document reference (getAll) rather than a
    // `where('__name__', 'in', batch)` query: filtering on the documentId
    // requires Key values, not bare id strings, so passing plain ids throws
    // "__key__ filter value must be a Key". getAll takes plain refs, has no
    // 10-item cap, and returns missing docs with `exists === false`.
    const refs = (userIds as string[]).map((id) => adminDb.collection('users').doc(id))
    const docs = refs.length > 0 ? await adminDb.getAll(...refs) : []
    for (const doc of docs) {
      if (!doc.exists) continue
      usersById.set(doc.id, { id: doc.id, ...serializeFirestoreValue(doc.data()) })
    }
  } catch (err) {
    console.error('Error fetching users for verification requests:', err)
  }

  const requestsWithUsers = verificationRequests.map((request: any) => {
    const userId = String(request.userId || request.user_id || request.id || '').trim()
    return {
      ...request,
      userId,
      user: usersById.get(userId) || null,
    }
  })

  // Limit organizer list for quick toggle (avoid loading all users).
  let organizers: any[] = []
  try {
    let orgQuery: any = adminDb.collection('users').where('role', '==', 'organizer')
    try {
      orgQuery = orgQuery.orderBy('created_at', 'desc')
    } catch {
      try {
        orgQuery = orgQuery.orderBy('createdAt', 'desc')
      } catch {
        // no-op
      }
    }
    const snap = await orgQuery.limit(500).get()
    organizers = snap.docs.map((doc: any) => {
      const u = serializeFirestoreValue(doc.data())
      return {
        id: doc.id,
        full_name: u.full_name,
        email: u.email,
        is_verified: Boolean(u.is_verified),
        verification_status: u.verification_status || 'none',
        created_at: u.created_at,
      }
    })
  } catch (err) {
    console.error('Error fetching organizers:', err)
    organizers = []
  }

  return (
    <ConsolePage title="Trust & Safety">
      <ConsoleTabs tabs={TRUST_TABS} />
      <ConsoleCaption>
        Organizer identity submissions waiting on a decision, and a manual override for verifying any
        organizer by hand.
      </ConsoleCaption>

      <AdminVerifyClient requestsWithUsers={requestsWithUsers} organizers={organizers} />
    </ConsolePage>
  )
}
