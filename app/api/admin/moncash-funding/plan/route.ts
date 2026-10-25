import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { loadPrefundingPlan, PREFUNDING_REQUESTS_COLLECTION } from '@/lib/payouts/prefunding-plan-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET the MonCash prefunding plan: live pool balance (or the error), the
 * minimum / recommended / maximum numbers, warnings, per-event breakdown,
 * deadlines, the next Digicel cutoff and the recent request log.
 * Read-only: never moves money, never contacts Digicel.
 */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  try {
    const [{ plan, balance, config }, requestsSnap] = await Promise.all([
      loadPrefundingPlan(),
      adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).orderBy('createdAt', 'desc').limit(20).get(),
    ])
    const requests = requestsSnap.docs.map((d: any) => {
      const r = d.data() || {}
      return {
        id: d.id,
        reference: r.reference || null,
        amountHtg: Number(r.amountHtg) || 0,
        choice: r.choice || null,
        status: r.status || 'generated',
        createdAt: r.createdAt || null,
        createdByEmail: r.createdByEmail || null,
        sentAt: r.sentAt || null,
        completedAt: r.completedAt || null,
        balanceAtGenerationHtg: r.balanceAtGenerationHtg ?? null,
        balanceAtSentHtg: r.balanceAtSentHtg ?? null,
        balanceAtCompletionHtg: r.balanceAtCompletionHtg ?? null,
      }
    })
    return adminOk({
      plan,
      balance,
      contacts: { to: config.digicel.to, cc: config.digicel.cc, from: config.digicel.fromEmail },
      requests,
    })
  } catch (e: any) {
    console.error('[admin/moncash-funding/plan] failed', e)
    return adminError('Failed to compute the prefunding plan', 500, e?.message || String(e))
  }
}
