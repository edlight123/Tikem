/**
 * Request handling shared by every /api/.../invite* route, with dependencies
 * injected so the order of checks is unit tested without Firestore
 * (__tests__/invites.test.ts): auth, then the remote switch
 * (config/auth.invites, fails closed, 404 when off), then a per-uid rate limit.
 */

import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rate-limit'
import { normalizeFriendIds } from './policy'
import type { SendInvitesResult } from './server'

export const NO_STORE = { 'Cache-Control': 'private, no-store' }
const RETRY_AFTER_SEC = 60

export interface InviteGuardDeps {
  getUser: () => Promise<{ id: string; full_name?: string | null } | null>
  flagOn: () => Promise<boolean>
  /** Request-rate limit (not the daily invite caps). Omit for none. */
  rateLimit?: (uid: string) => Promise<{ limited: boolean }>
}

export function json(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } })
}

export const featureOff = () => json({ error: 'feature_off', enabled: false }, 404)

export async function inviteGuard(
  deps: InviteGuardDeps
): Promise<{ uid: string; name: string } | NextResponse> {
  const user = await deps.getUser().catch(() => null)
  if (!user?.id) return json({ error: 'Unauthorized' }, 401)
  const on = await deps.flagOn().catch(() => false)
  if (!on) return featureOff()
  if (deps.rateLimit) {
    const rl = await deps.rateLimit(user.id).catch(() => ({ limited: true }))
    if (rl.limited) {
      return json({ error: 'rate_limited', retryAfterSec: RETRY_AFTER_SEC }, 429, { 'Retry-After': String(RETRY_AFTER_SEC) })
    }
  }
  return { uid: user.id, name: String(user.full_name || '') }
}

/** Per-uid request budgets on the shared Firestore counter. Fail closed. */
export const invitePickerRateLimit = (uid: string) =>
  consumeRateLimit({ key: `invites-picker:uid:${uid}`, limit: 60, windowMs: 60_000 })
export const inviteSendRateLimit = (uid: string) =>
  consumeRateLimit({ key: `invites-send:uid:${uid}`, limit: 20, windowMs: 60_000 })
export const inviteMiscRateLimit = (uid: string) =>
  consumeRateLimit({ key: `invites-misc:uid:${uid}`, limit: 30, windowMs: 60_000 })

// ── POST /api/events/[id]/invite ────────────────────────────────────────────

const SEND_ERRORS: Record<Exclude<SendInvitesResult['status'], 'ok'>, number> = {
  event_not_found: 404,
  event_unavailable: 400,
  not_connected: 403,
  rate_limited: 429,
}

export async function handleSendInvites(
  deps: InviteGuardDeps & {
    send: (p: { inviterUid: string; inviterName: string; friendIds: string[] }) => Promise<SendInvitesResult>
  },
  body: unknown
): Promise<NextResponse> {
  const g = await inviteGuard(deps)
  if (g instanceof NextResponse) return g
  const friendIds = normalizeFriendIds((body as any)?.friendIds, g.uid)
  if (!friendIds) return json({ error: 'invalid_friend_ids' }, 400)
  try {
    const result = await deps.send({ inviterUid: g.uid, inviterName: g.name, friendIds })
    if (result.status !== 'ok') return json({ error: result.status }, SEND_ERRORS[result.status])
    return json({ ok: true, sent: result.sent, skipped: result.skipped })
  } catch (err) {
    console.error('[invites] send failed', (err as any)?.message)
    return json({ error: 'internal_error' }, 500)
  }
}
