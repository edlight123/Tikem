import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { loadMoneyMap } from '@/lib/payouts/money-map-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/admin/money-map?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Where the money sits, per currency and rail, with the fund_transfers ledger
 * applied and the Haiti owed-vs-prefunded position. Read-only. Admin only.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)

  const params = new URL(request.url).searchParams
  const from = params.get('from') || null
  const to = params.get('to') || null
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return adminError('Dates must be YYYY-MM-DD', 400)
  }
  if (from && to && from > to) return adminError('"from" is after "to"', 400)

  try {
    const map = await loadMoneyMap({ from, to })
    return adminOk({ map })
  } catch (e: any) {
    console.error('[admin/money-map] load failed', e?.message || e)
    return adminError('Could not build the money map', 500)
  }
}
