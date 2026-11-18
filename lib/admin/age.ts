/**
 * How long an admin queue item has been waiting, and how loudly to say it.
 *
 * Age is the console's organizing signal (see the redesign spec): a count says
 * how much work there is, an age says whether you are behind. These are pure so
 * the same thresholds drive the sidebar, the landing list and every queue row.
 */

export type AgeTier = 'none' | 'fresh' | 'waiting' | 'overdue'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Thresholds are inclusive of the lower bound: 24h exactly is already 'waiting'. */
const WAITING_AT = DAY
const OVERDUE_AT = 3 * DAY

function elapsed(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  // Clock skew between a Firestore write and this render can put a timestamp in
  // the future. Report that as brand new rather than as a negative age.
  return Math.max(0, now.getTime() - then.getTime())
}

/**
 * A compact age: "0m", "5m", "19h", "6d". Always floors — an item is never
 * shown as older than it actually is.
 */
export function formatAge(iso: string | null | undefined, now: Date = new Date()): string {
  const ms = elapsed(iso, now)
  if (ms === null) return '—'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

export function ageTier(iso: string | null | undefined, now: Date = new Date()): AgeTier {
  const ms = elapsed(iso, now)
  if (ms === null) return 'none'
  if (ms > OVERDUE_AT) return 'overdue'
  if (ms >= WAITING_AT) return 'waiting'
  return 'fresh'
}

const TIER_CLASS: Record<AgeTier, string> = {
  none: 'text-fg-subtle',
  fresh: 'text-fg-subtle',
  waiting: 'text-warning-strong',
  overdue: 'text-danger-strong',
}

export function ageClass(iso: string | null | undefined, now: Date = new Date()): string {
  return TIER_CLASS[ageTier(iso, now)]
}
