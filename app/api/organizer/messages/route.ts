/**
 * GET /api/organizer/messages
 *
 * The signed-in organizer's message threads — the attendee questions written
 * through /api/events/contact-organizer, each with the organizer's replies
 * attached and an unread flag.
 *
 * Query params:
 *   eventId — narrow to one event (the per-event inbox)
 *   limit   — 1..100, default 30
 *   unread  — 'true' to return only unacknowledged threads
 *
 * Scoping is by `organizer_id == <acting org>` and nothing else: the caller's
 * own org, or one they are an admin/manager of (lib/organizer/context.ts). The
 * caller never supplies an organizer id, only an org they belong to.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { requireOrg } from '@/lib/organizer/context'
import {
  listThreadsForOrganizer,
  countUnread,
  DEFAULT_THREADS_PER_PAGE,
} from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in.', code: 'unauthorized' },
        { status: 401 }
      )
    }

    const org = await requireOrg('view')
    if (!org.ok) return org.response

    const url = new URL(request.url)
    const eventId = url.searchParams.get('eventId')?.trim() || undefined
    const unreadOnly = url.searchParams.get('unread') === 'true'
    const rawLimit = parseInt(url.searchParams.get('limit') || '', 10)

    const all = await listThreadsForOrganizer({
      organizerId: org.value.orgId,
      eventId,
      limit: Number.isFinite(rawLimit) ? rawLimit : DEFAULT_THREADS_PER_PAGE,
    })

    // The unread count describes the whole page, not the filtered slice —
    // otherwise "unread only" would always report the number it just returned.
    return NextResponse.json({
      threads: unreadOnly ? all.filter((t) => t.unread) : all,
      unreadCount: countUnread(all),
    })
  } catch (error) {
    console.error('organizer/messages list failed', error)
    return NextResponse.json(
      { error: 'Could not load your messages.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
