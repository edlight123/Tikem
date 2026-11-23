/**
 * GET /api/cron/eventbrite-sync (Vercel cron, CRON_SECRET), daily.
 *
 * Every org that connected Eventbrite with auto-sync on gets new live events
 * listed, changes picked up, cancelled ones unpublished and past events'
 * public counts (lib/import/eventbrite-sync-server). A no-op until the
 * Eventbrite app is configured.
 */
import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { eventbriteConfigured } from '@/lib/import/eventbrite-server'
import { syncAllEventbrite } from '@/lib/import/eventbrite-sync-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!eventbriteConfigured()) return NextResponse.json({ ok: true, skipped: 'not_configured' })
  const runs = await syncAllEventbrite({ deadlineMs: 270_000 })
  const sum = (k: 'created' | 'updated' | 'unpublished' | 'past' | 'needs_review') => runs.reduce((s, r) => s + r[k], 0)
  return NextResponse.json({
    ok: true,
    orgs: runs.length,
    created: sum('created'),
    updated: sum('updated'),
    unpublished: sum('unpublished'),
    past: sum('past'),
    needs_review: sum('needs_review'),
    rate_limited: runs.filter((r) => r.rate_limited).length,
    failed: runs.filter((r) => !r.ok).length,
  })
}
