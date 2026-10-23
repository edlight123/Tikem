import { getCurrentUser } from '@/lib/auth'
import { normalizePageParams } from '@/lib/profile/following'
import { getFollowingPage } from '@/lib/profile/following-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/profile/following?offset=0&limit=20
 * The organizers the signed-in user follows, most recent first, one page at a
 * time. Own data only: there is no way to ask for someone else's list.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const { offset, limit } = normalizePageParams(url.searchParams.get('offset'), url.searchParams.get('limit'))
  try {
    const page = await getFollowingPage(user.id, offset, limit)
    return Response.json(page, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[profile/following] read failed', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
