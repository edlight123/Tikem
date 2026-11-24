import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { resolveOrgRecipients } from '@/lib/notifications/orgRecipients'
import {
  eligibleOrganizerIds,
  seasonNudgeCopy,
  seasonNudgeLinks,
  seasonNudgesDue,
} from '@/lib/notifications/seasonNudge'

export const dynamic = 'force-dynamic'

/**
 * Daily: about three weeks before an occasion with holiday poster templates,
 * tell organizers it is coming and link the occasion's page (its posters and
 * "Add an event"). See lib/notifications/seasonNudge.
 *
 * Every recipient passes sendDiscretionary on their own: the
 * notify_organizer_season switch (opt-in in Canada and France), quiet hours,
 * and the once-per-occasion-per-year cap. A person in quiet hours is retried
 * on the next daily run, inside the grace days.
 */

/** Ceiling on one run's scan of events for organizer ids. */
const MAX_EVENTS_SCANNED = 5000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const due = seasonNudgesDue(new Date())
  // Most days: nothing is three weeks out, and the run ends here.
  if (due.length === 0) return NextResponse.json({ due: [], notified: 0 })

  try {
    // Only the fields the eligibility check reads.
    const snap = await adminDb
      .collection('events')
      .select('organizer_id', 'seed_batch', 'deleted', 'is_deleted')
      .limit(MAX_EVENTS_SCANNED)
      .get()
    const organizers = eligibleOrganizerIds(snap.docs.map((d: { data: () => Record<string, any> }) => d.data()))

    // An org's owner, admins and managers; one person on two teams hears once
    // (the cap is per person, and the set dedupes within the run).
    const people = new Set<string>()
    for (const orgId of organizers) {
      for (const uid of await resolveOrgRecipients({ orgId, kind: 'event_ops' })) people.add(uid)
    }

    let notified = 0
    for (const nudge of due) {
      const { url, deepLink } = seasonNudgeLinks(nudge.occasion)
      for (const userId of people) {
        const sent = await sendDiscretionary({
          userId,
          category: 'organizer_season',
          capKey: nudge.capKey,
          type: 'organizer_season',
          title: '',
          body: '',
          copy: (user) => seasonNudgeCopy(nudge.occasion, nudge.daysUntil, user?.language),
          url,
          data: { occasion: nudge.occasion, deepLink },
        })
        if (sent) notified++
      }
    }

    return NextResponse.json({
      due: due.map((d) => d.occasion),
      organizers: organizers.length,
      people: people.size,
      notified,
      truncated: snap.size >= MAX_EVENTS_SCANNED,
    })
  } catch (error: any) {
    console.error('[organizer-season] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
