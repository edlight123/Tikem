/**
 * GET /api/invites/summary  the caller's own invite results: invites sent,
 * people who joined from their link, people who bought. Counts only.
 * Behind config/auth.invites (404 feature_off when off).
 */
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { inviteGuard, inviteMiscRateLimit, json } from '@/lib/invites/handlers'
import { getInviteSummary } from '@/lib/invites/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await inviteGuard({
    getUser: async () => {
      const u = await getCurrentUser()
      return u ? { id: u.id } : null
    },
    flagOn: () => isSocialFlagOn('invites'),
    rateLimit: inviteMiscRateLimit,
  })
  if (!('uid' in g)) return g
  try {
    return json({ enabled: true, ...(await getInviteSummary(g.uid)) })
  } catch (err) {
    console.error('[invites] summary failed', (err as any)?.message)
    return json({ enabled: true, sent: 0, joined: 0, purchased: 0 })
  }
}
