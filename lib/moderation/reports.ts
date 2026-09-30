/**
 * User reports of objectionable content (App Store guideline 1.2).
 *
 * Events are published by organizers WITHOUT pre-approval, so every attendee
 * must be able to flag an event or an organizer, and an admin must be told
 * quickly enough to act within 24 hours. This module is the ONE writer of
 * `event_reports` and `organizer_reports`; clients never touch those
 * collections (firestore.rules denies them) — they POST to
 *   /api/events/[id]/report
 *   /api/organizers/[id]/report
 *
 * Data model
 * ----------
 *   event_reports/{auto}      { event_id, organizer_id, reporter_uid, reason, details, created_at, status }
 *   organizer_reports/{auto}  { organizer_id, reporter_uid, reason, details, created_at, status }
 *   status: 'open' → 'dismissed' | 'actioned' (set by an admin, see resolveReports)
 *
 *   events/{id}.reports_count          OPEN reports on the event. The admin
 *                                       "Reported" tab is `reports_count > 0`.
 *   events/{id}.hidden_pending_review  set once AUTO_HIDE_THRESHOLD distinct
 *                                       people have an open report on it (see below).
 *   organizer_moderation/{uid}         { open_reports_count, last_reported_at } —
 *                                       NOT on users/{uid}: that doc is owner-
 *                                       writable, so an organizer could zero it.
 *
 * Dedupe: one OPEN report per (reporter, target). The guard is a deterministic
 * `report_dedupe/{kind}_{targetId}_{uid}` doc read inside the same transaction
 * that creates the report — a doc read locks, a query for "no open report yet"
 * would not, so a double tap cannot slip two reports (and a +2) through. Because
 * of this, `reports_count` is also the number of DISTINCT open reporters.
 *
 * Rate limit: REPORTS_PER_HOUR new reports per user across both kinds, counted
 * in `report_rate/{uid}` inside the same transaction (no composite index).
 *
 * Auto-hide (conservative, reversible): at AUTO_HIDE_THRESHOLD distinct open
 * reporters the event gets `hidden_pending_review: true`. That ONLY removes it
 * from discovery surfaces (Home / Discover / Search / category rails on web and
 * mobile, which all check the flag in memory); the event stays published, its
 * link keeps working and tickets already sold are untouched. An admin clears
 * the flag by dismissing the reports, or unpublishes the event.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const REPORT_REASONS = [
  'spam',
  'scam_or_fraud',
  'offensive',
  'violence',
  'sexual',
  'illegal',
  'misleading',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export type ReportTargetKind = 'event' | 'organizer'

export const MAX_REPORT_DETAILS = 1000
/** Distinct open reporters at which an event drops out of discovery pending review. */
export const AUTO_HIDE_THRESHOLD = 5
/** New reports one user may file per rolling hour, across events and organizers. */
export const REPORTS_PER_HOUR = 10
const RATE_WINDOW_MS = 60 * 60 * 1000

export const REPORT_COLLECTION: Record<ReportTargetKind, string> = {
  event: 'event_reports',
  organizer: 'organizer_reports',
}
export const REPORT_DEDUPE_COLLECTION = 'report_dedupe'
export const REPORT_RATE_COLLECTION = 'report_rate'
export const ORGANIZER_MODERATION_COLLECTION = 'organizer_moderation'

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)
}

export type ParsedReport =
  | { ok: true; reason: ReportReason; details: string }
  | { ok: false; code: 'invalid_reason' | 'details_too_long' | 'bad_request'; error: string }

/** Validate a request body `{ reason, details? }`. Pure; exported for tests. */
export function parseReportBody(body: unknown): ParsedReport {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'bad_request', error: 'Malformed request body.' }
  }
  const { reason, details } = body as Record<string, unknown>
  if (!isReportReason(reason)) {
    return { ok: false, code: 'invalid_reason', error: 'Pick a reason for your report.' }
  }
  if (details !== undefined && details !== null && typeof details !== 'string') {
    return { ok: false, code: 'bad_request', error: 'Details must be text.' }
  }
  const text = typeof details === 'string' ? details.trim() : ''
  if (text.length > MAX_REPORT_DETAILS) {
    return {
      ok: false,
      code: 'details_too_long',
      error: `Keep details under ${MAX_REPORT_DETAILS} characters.`,
    }
  }
  return { ok: true, reason, details: text }
}

export function dedupeKey(kind: ReportTargetKind, targetId: string, uid: string): string {
  return `${kind}_${targetId}_${uid}`
}

export type FileReportResult =
  | {
      status: 'created'
      reportId: string
      /** Open reports on the target after this one (== distinct open reporters). */
      openCount: number
      /** True when THIS report tipped the event into hidden_pending_review. */
      autoHidden: boolean
      targetTitle: string
      organizerId: string
    }
  | { status: 'duplicate'; reportId: string }
  | { status: 'rate_limited' }
  | { status: 'not_found' }
  | { status: 'self' }

export async function fileReport(params: {
  kind: ReportTargetKind
  targetId: string
  reporterUid: string
  reason: ReportReason
  details: string
  now?: Date
}): Promise<FileReportResult> {
  const { kind, targetId, reporterUid, reason, details } = params
  const now = params.now ?? new Date()

  const targetRef =
    kind === 'event'
      ? adminDb.collection('events').doc(targetId)
      : adminDb.collection('users').doc(targetId)
  const modRef =
    kind === 'organizer' ? adminDb.collection(ORGANIZER_MODERATION_COLLECTION).doc(targetId) : null
  const dedupeRef = adminDb
    .collection(REPORT_DEDUPE_COLLECTION)
    .doc(dedupeKey(kind, targetId, reporterUid))
  const rateRef = adminDb.collection(REPORT_RATE_COLLECTION).doc(reporterUid)
  const reportRef = adminDb.collection(REPORT_COLLECTION[kind]).doc()

  return adminDb.runTransaction(async (tx: any) => {
    const [targetSnap, dedupeSnap, rateSnap, modSnap] = await Promise.all([
      tx.get(targetRef),
      tx.get(dedupeRef),
      tx.get(rateRef),
      modRef ? tx.get(modRef) : Promise.resolve(null),
    ])

    if (!targetSnap.exists) return { status: 'not_found' } as const
    const target = targetSnap.data() || {}

    if (kind === 'event') {
      // Drafts and rejected events are not public: a report on one can only
      // come from a guessed id, so do not confirm it exists.
      if (target.is_published !== true || target.rejected === true) {
        return { status: 'not_found' } as const
      }
      if (target.organizer_id === reporterUid) return { status: 'self' } as const
    } else if (targetId === reporterUid) {
      return { status: 'self' } as const
    }

    if (dedupeSnap.exists && dedupeSnap.data()?.status === 'open') {
      return { status: 'duplicate', reportId: String(dedupeSnap.data()?.report_id || '') } as const
    }

    const rate = rateSnap.exists ? rateSnap.data() || {} : {}
    const windowStart = toMillis(rate.window_start)
    const inWindow = windowStart > 0 && now.getTime() - windowStart < RATE_WINDOW_MS
    const used = inWindow ? Number(rate.count) || 0 : 0
    if (used >= REPORTS_PER_HOUR) return { status: 'rate_limited' } as const

    const organizerId = kind === 'event' ? String(target.organizer_id || '') : targetId
    const targetTitle =
      kind === 'event'
        ? String(target.title || 'Untitled event')
        : String(target.organization_name || target.full_name || target.email || 'Organizer')

    tx.set(reportRef, {
      ...(kind === 'event' ? { event_id: targetId } : {}),
      organizer_id: organizerId,
      reporter_uid: reporterUid,
      reason,
      details,
      target_title: targetTitle,
      created_at: now,
      status: 'open',
    })
    tx.set(dedupeRef, { report_id: reportRef.id, kind, target_id: targetId, status: 'open', created_at: now })
    tx.set(rateRef, { window_start: inWindow ? rate.window_start : now, count: used + 1 })

    let openCount: number
    let autoHidden = false
    if (kind === 'event') {
      openCount = (Number(target.reports_count) || 0) + 1
      autoHidden = openCount >= AUTO_HIDE_THRESHOLD && target.hidden_pending_review !== true
      tx.update(targetRef, {
        reports_count: FieldValue.increment(1),
        last_reported_at: now,
        ...(autoHidden ? { hidden_pending_review: true, hidden_pending_review_at: now } : {}),
      })
    } else {
      const mod = modSnap?.exists ? modSnap.data() || {} : {}
      openCount = (Number(mod.open_reports_count) || 0) + 1
      tx.set(
        modRef!,
        { organizer_id: targetId, open_reports_count: FieldValue.increment(1), last_reported_at: now },
        { merge: true }
      )
    }

    return {
      status: 'created',
      reportId: reportRef.id,
      openCount,
      autoHidden,
      targetTitle,
      organizerId,
    } as const
  })
}

export type ReportResolution = 'dismissed' | 'actioned'

/**
 * Close every OPEN report on a target. Resets the open counter (so the event
 * leaves the admin Reported tab), clears hidden_pending_review, and releases the
 * dedupe guards so the same people can report again if it recurs.
 */
export async function resolveReports(params: {
  kind: ReportTargetKind
  targetId: string
  resolution: ReportResolution
  adminId: string
  note?: string | null
  now?: Date
}): Promise<{ resolved: number }> {
  const { kind, targetId, resolution, adminId } = params
  const now = params.now ?? new Date()
  const field = kind === 'event' ? 'event_id' : 'organizer_id'

  // Single-field equality (no composite index); status is filtered in memory.
  const snap = await adminDb.collection(REPORT_COLLECTION[kind]).where(field, '==', targetId).get()
  const open = snap.docs.filter((d: any) => d.data()?.status === 'open')

  const batch = adminDb.batch()
  for (const d of open) {
    const data = d.data() || {}
    batch.update(d.ref, {
      status: resolution,
      resolved_at: now,
      resolved_by: adminId,
      resolution_note: params.note || null,
    })
    if (data.reporter_uid) {
      batch.delete(
        adminDb.collection(REPORT_DEDUPE_COLLECTION).doc(dedupeKey(kind, targetId, String(data.reporter_uid)))
      )
    }
  }

  if (kind === 'event') {
    const eventRef = adminDb.collection('events').doc(targetId)
    const eventSnap = await eventRef.get()
    if (eventSnap.exists) {
      batch.update(eventRef, { reports_count: 0, hidden_pending_review: false, reports_resolved_at: now })
    }
  } else {
    batch.set(
      adminDb.collection(ORGANIZER_MODERATION_COLLECTION).doc(targetId),
      { organizer_id: targetId, open_reports_count: 0, reports_resolved_at: now },
      { merge: true }
    )
  }

  await batch.commit()
  return { resolved: open.length }
}

/** Open reports on one target, newest first, for the admin review sheet. */
export async function listOpenReports(kind: ReportTargetKind, targetId: string, max = 50) {
  const field = kind === 'event' ? 'event_id' : 'organizer_id'
  const snap = await adminDb.collection(REPORT_COLLECTION[kind]).where(field, '==', targetId).limit(200).get()
  return snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((r: any) => r.status === 'open')
    .map((r: any) => ({
      id: String(r.id),
      reason: String(r.reason || 'other'),
      details: String(r.details || ''),
      reporter_uid: String(r.reporter_uid || ''),
      created_at: toIso(r.created_at),
    }))
    .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, max)
}

function toMillis(v: any): number {
  if (!v) return 0
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  if (v instanceof Date) return v.getTime()
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function toIso(v: any): string {
  const ms = toMillis(v)
  return ms ? new Date(ms).toISOString() : ''
}
