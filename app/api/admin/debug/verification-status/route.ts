import { NextRequest } from 'next/server'
import { requireDevTools } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireDevTools()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }

    // Get all verification requests
    const snapshot = await adminDb.collection('verification_requests').get()

    const requests = snapshot.docs.map((doc: any) => {
      const data = doc.data()
      return {
        id: doc.id,
        status: data.status || 'NO_STATUS',
        userId: data.userId || data.user_id || null,
        reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || data.reviewed_at || null,
        reviewNotes: data.reviewNotes || data.rejection_reason || null,
      }
    })

    // Count by status
    const statusCounts: Record<string, number> = {}
    requests.forEach((r: { status: string }) => {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
    })

    return adminOk({
      total: requests.length,
      statusCounts,
      requests,
    })
  } catch (e: any) {
    console.error('Debug verification status error:', e)
    return adminError('Failed to fetch', 500, e?.message)
  }
}

// The POST that rewrote a request's status directly was removed: it bypassed
// the review flow, its state guards and its audit trail. Use the admin review UI.
