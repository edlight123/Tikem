/**
 * Request handling for GET /api/connections/suggestions and
 * GET /api/events/[id]/friends-going, with every dependency injected so the
 * order of checks (auth, flag, rate limit) is unit-tested without Firestore
 * (__tests__/friend-suggestions-routes.test.ts).
 */

import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rate-limit'
import type { FriendSuggestion, PublicUserSummary } from '@/types/social'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** Resolves `limited: true` when the caller is over budget (or the counter cannot be read). */
export type SocialRateLimit = (uid: string) => Promise<{ limited: boolean }>

export interface SocialRouteDeps<T> {
  getUserId: () => Promise<string | null>
  flagOn: () => Promise<boolean>
  rateLimit: SocialRateLimit
  load: (uid: string) => Promise<T>
}

const RETRY_AFTER_SEC = 60

/**
 * Per-uid budgets on the shared Firestore counter (lib/rate-limit.ts), so they
 * hold across serverless instances. Suggestions fan out to many reads, so they
 * get the tighter one. Fails closed like every other caller of the counter.
 */
export const suggestionsRateLimit: SocialRateLimit = (uid) =>
  consumeRateLimit({ key: `social-suggestions:uid:${uid}`, limit: 20, windowMs: 60_000 })
export const friendsGoingRateLimit: SocialRateLimit = (uid) =>
  consumeRateLimit({ key: `social-friends-going:uid:${uid}`, limit: 60, windowMs: 60_000 })

/**
 * Auth, then the remote switch, then the rate limit. The switch comes before
 * the limiter so a page that calls this while the feature is off (the web
 * event page does for every signed-in viewer) costs no counter write.
 */
async function guard<T>(
  deps: SocialRouteDeps<T>,
  offBody: Record<string, unknown>
): Promise<{ uid: string } | NextResponse> {
  const uid = await deps.getUserId().catch(() => null)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  // Fail closed: a flag read error is OFF, and OFF looks like "nothing to show".
  const on = await deps.flagOn().catch(() => false)
  if (!on) return NextResponse.json(offBody, { headers: NO_STORE })
  const rl = await deps.rateLimit(uid).catch(() => ({ limited: true }))
  if (rl.limited) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec: RETRY_AFTER_SEC },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(RETRY_AFTER_SEC) } }
    )
  }
  return { uid }
}

export async function handleSuggestions(deps: SocialRouteDeps<FriendSuggestion[]>): Promise<NextResponse> {
  const g = await guard(deps, { enabled: false, suggestions: [] })
  if (g instanceof NextResponse) return g
  try {
    const suggestions = await deps.load(g.uid)
    return NextResponse.json({ enabled: true, suggestions }, { headers: NO_STORE })
  } catch (err) {
    console.error('[connections/suggestions] failed', err)
    return NextResponse.json({ enabled: true, suggestions: [] }, { headers: NO_STORE })
  }
}

export async function handleFriendsGoing(
  deps: SocialRouteDeps<{ count: number; friends: PublicUserSummary[] }>
): Promise<NextResponse> {
  const g = await guard(deps, { enabled: false, count: 0, friends: [] })
  if (g instanceof NextResponse) return g
  try {
    const { count, friends } = await deps.load(g.uid)
    return NextResponse.json({ enabled: true, count, friends }, { headers: NO_STORE })
  } catch (err) {
    console.error('[events/friends-going] failed', err)
    return NextResponse.json({ enabled: true, count: 0, friends: [] }, { headers: NO_STORE })
  }
}
