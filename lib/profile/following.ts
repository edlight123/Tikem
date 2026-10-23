/**
 * Pure helpers behind the /profile "Following" panel (no Firebase imports, so
 * they are unit-testable). The server read lives in ./following-server.ts.
 *
 * The list is the reader's OWN follows (organizer_follows where follower_id ==
 * uid), the same data as the mobile SubscriptionsScreen. Display fields come
 * from public_profiles/{organizerId}, the cross-user-safe projection; never
 * from users/{uid}, which is owner-only and holds PII.
 */

import { toDateOrNull } from './dashboard'

/** Rows per page. "Show more" fetches the next slice. */
export const FOLLOWING_PAGE_SIZE = 20
/** Hard ceiling on how many follow docs one read scans. */
export const FOLLOWING_MAX_SCAN = 2000

export interface FollowDocLike {
  organizer_id?: unknown
  created_at?: unknown
  createdAt?: unknown
}

export interface FollowedOrganizer {
  id: string
  /** Brand name, else personal name; null when the projection has neither. */
  name: string | null
  /** Organization logo, else profile photo; null when there is none. */
  avatar: string | null
  isVerified: boolean
}

export interface FollowingPage {
  items: FollowedOrganizer[]
  total: number
  /** Offset of the next page, or null when this was the last one. */
  nextOffset: number | null
}

/**
 * Distinct organizer ids, most recently followed first. Follow docs have no
 * single timestamp field (web writes created_at, older docs may carry
 * createdAt or nothing), so this sorts in memory instead of an orderBy that
 * would silently drop the undated ones. Undated follows go last, in read order.
 */
export function orderFollowedOrganizerIds(follows: FollowDocLike[]): string[] {
  const latest = new Map<string, number>()
  follows.forEach((f) => {
    const id = String(f.organizer_id ?? '').trim()
    if (!id) return
    const t = (toDateOrNull(f.created_at) || toDateOrNull(f.createdAt))?.getTime() ?? -Infinity
    const prev = latest.get(id)
    if (prev === undefined || t > prev) latest.set(id, t)
  })
  // Map keeps insertion order, and Array#sort is stable, so ties keep read order.
  return Array.from(latest.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
}

/** One row from a public_profiles doc (or an empty object when it is missing). */
export function toFollowedOrganizer(id: string, data: Record<string, any> | null | undefined): FollowedOrganizer {
  const d = data || {}
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const name = str(d.organization_name) || str(d.full_name)
  const avatar = str(d.organization_logo) || str(d.photo_url)
  return { id, name: name || null, avatar: avatar || null, isVerified: d.is_verified === true }
}

/** Clamp a requested offset/limit to sane values. */
export function normalizePageParams(offset: unknown, limit: unknown): { offset: number; limit: number } {
  const o = Math.floor(Number(offset))
  const l = Math.floor(Number(limit))
  return {
    offset: Number.isFinite(o) && o > 0 ? o : 0,
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, 50) : FOLLOWING_PAGE_SIZE,
  }
}

/** The slice of ids for one page, and where the next page starts. */
export function pageOfIds(ids: string[], offset: number, limit: number): { ids: string[]; nextOffset: number | null } {
  const slice = ids.slice(offset, offset + limit)
  const end = offset + slice.length
  return { ids: slice, nextOffset: end < ids.length ? end : null }
}
