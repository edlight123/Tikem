/**
 * Retired as a schedule: the "new events in your city" push now goes out from
 * /api/cron/weekly-digest, as the fallback when there is nothing on this
 * weekend (lib/notifications/weekly-digest). Two Thursday pushes about the same
 * city would be one too many.
 *
 * Kept as an alias so a leftover scheduler call runs the same Thursday job,
 * which only sends in each person's local early evening and is capped once a
 * week, so a stray call cannot double-send.
 */
export { GET } from '../weekly-digest/route'

// Route segment config must be literal here (Next.js reads it statically).
export const dynamic = 'force-dynamic'
export const maxDuration = 300
