/**
 * Community shares go live right away when they pass the safety checks
 * (lib/community/trust; Tikèm owner, 2026-11-26: "straight away like tikra").
 * A share that fails any check waits for an admin as before, with the reasons
 * on the submission (`hold_reasons`) for /admin/community.
 *
 * Publishing uses exactly what an admin's "approve" does (submissionToEvent,
 * owned by the community account, credited and claimable, selling nothing on
 * Tikèm), with the member's own details as the fields. The event and the
 * submission are written in one batch.
 */
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { timezoneForEvent } from '@/lib/events/composer-country'
import { firstPublishStamp } from '@/lib/events/publishedAt'
import { fieldsFromSubmission, parseSubmissionFields, parseSubmitterDetails, submissionToEvent } from '@/lib/community/submissions'
import { ensureCommunityOrg } from '@/lib/community/org'
import { holdReasons, RATE_WINDOW_MS, type HoldReason } from '@/lib/community/trust'

/** Statuses that count against an account: an admin said no, or took a live share down. */
const BAD_OUTCOMES = new Set(['rejected', 'removed'])

/**
 * What this account has shared before: any rejection/removal, and how many in
 * the last 24h. A share that went live counts as removed when its event was
 * taken down by ANY path since (rejected, removed, hidden after reports, or
 * gone), not only through Community's Remove.
 */
export async function submissionHistory(uid: string, now: Date): Promise<{ hasPastRemoval: boolean; recentCount: number }> {
  const snap = await adminDb.collection('event_submissions').where('submitted_by', '==', uid).get()
  let hasPastRemoval = false
  let recentCount = 0
  const liveEventIds: string[] = []
  for (const d of snap.docs as any[]) {
    const s = d.data() || {}
    if (BAD_OUTCOMES.has(String(s.status || ''))) hasPastRemoval = true
    if (s.status === 'approved' && typeof s.event_id === 'string' && s.event_id && !s.event_id.includes('/')) {
      liveEventIds.push(s.event_id)
    }
    const at = Date.parse(String(s.created_at || ''))
    if (Number.isFinite(at) && now.getTime() - at < RATE_WINDOW_MS) recentCount++
  }
  if (!hasPastRemoval && liveEventIds.length) {
    const refs = liveEventIds.slice(0, 100).map((id) => adminDb.collection('events').doc(id))
    const events = (await adminDb.getAll(...refs)) as any[]
    hasPastRemoval = events.some((e) => {
      if (!e?.exists) return true
      const ev = e.data() || {}
      return ev.rejected === true || ev.hidden_pending_review === true || String(ev.status || '') === 'removed'
    })
  }
  return { hasPastRemoval, recentCount }
}

async function authCreatedAtMs(uid: string): Promise<number | null> {
  try {
    const u = await adminAuth.getUser(uid)
    const t = Date.parse(String(u.metadata?.creationTime || ''))
    return Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

export type ShareOutcome = { status: 'published'; eventId: string } | { status: 'pending'; holdReasons: HoldReason[] }

/**
 * Decide a new share (already validated and rate-limited by the route) and
 * write it: published with its event, or pending with the hold reasons.
 * `history` is read BEFORE this share is written.
 */
export async function decideShare(p: {
  uid: string
  submission: Record<string, any>
  body: Record<string, any>
  now?: Date
  /**
   * This account's count in the route's atomic per-user 24h counter, INCLUDING
   * this share (lib/rate-limit consumeRateLimit). Two shares sent at once each
   * get their own count, so neither slips under the limit.
   */
  windowCount?: number
}): Promise<ShareOutcome & { submissionId: string }> {
  const now = p.now || new Date()
  const nowIso = now.toISOString()
  const [history, createdAt] = await Promise.all([submissionHistory(p.uid, now), authCreatedAtMs(p.uid)])
  const details = parseSubmitterDetails(p.submission.details)
  const zone = timezoneForEvent(details.country || 'HT', details.city)
  const reasons = holdReasons({
    signedIn: true,
    authCreatedAtMs: createdAt,
    hasPastRemoval: history.hasPastRemoval,
    recentCount: Math.max(history.recentCount, (p.windowCount ?? 0) - 1),
    now,
    zone,
    body: p.body,
  })

  const subRef = adminDb.collection('event_submissions').doc()
  if (reasons.length === 0) {
    const parsed = parseSubmissionFields(fieldsFromSubmission(p.submission))
    const event = parsed.ok
      ? submissionToEvent(parsed.value, {
          submissionId: subRef.id,
          bannerUrl: p.submission.image_url || null,
          communityOrgId: await ensureCommunityOrg(nowIso),
          now: nowIso,
        })
      : null
    if (event) {
      const eventRef = adminDb.collection('events').doc()
      const batch = adminDb.batch()
      batch.set(eventRef, { ...event, ...firstPublishStamp(null, nowIso), created_by: p.uid, community_auto: true })
      batch.set(subRef, { ...p.submission, status: 'approved', auto_published: true, event_id: eventRef.id, decided_at: nowIso })
      await batch.commit()
      return { status: 'published', eventId: eventRef.id, submissionId: subRef.id }
    }
    reasons.push('incomplete')
  }
  await subRef.set({ ...p.submission, status: 'pending', hold_reasons: reasons })
  return { status: 'pending', holdReasons: reasons, submissionId: subRef.id }
}
