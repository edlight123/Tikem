/** GET /api/users/me/blocks — the signed-in user's blocked organizer ids. */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getBlockedOrganizerIds } from '@/lib/moderation/blocks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  const ids = await getBlockedOrganizerIds(user.id)
  return NextResponse.json({ organizerIds: Array.from(ids) })
}
