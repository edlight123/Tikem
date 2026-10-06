/**
 * Delete liveness recordings once they have done their job.
 *
 * WHY THIS EXISTS, AND IT IS NOT STORAGE COST. A 480p clip is ~1–2 MB, so ten
 * thousand organizers is a few dollars a year — cost is not the argument. The
 * argument is that a face recording is biometric data: it is the one artefact in
 * this system that cannot be reissued if it leaks. Keeping it after it has
 * served its purpose converts a solved problem into a standing liability, and
 * several jurisdictions (Illinois' BIPA, Texas' CUBI, GDPR's storage-limitation
 * principle for organizers in France) attach real consequences to holding it
 * longer than needed.
 *
 * So: the clip is kept while the decision is pending, and for a dispute window
 * after it. Then it goes. The verification RECORD stays — who was approved, by
 * whom, when, and the reviewer's note — because that is what an audit needs. The
 * face itself is not.
 *
 * Deliberately conservative: it never deletes a clip for a request that is still
 * pending, however old, because a stalled review is a reason to look at the
 * queue, not to destroy the evidence the reviewer needs.
 */

import { NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

/** How long a decided request keeps its recording, for disputes and appeals. */
const RETENTION_DAYS = 90

/** Statuses that mean a human has decided; only these are eligible for purging. */
const DECIDED = new Set(['approved', 'rejected'])

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization') || ''
  // Vercel Cron sends the secret as a bearer token.
  return auth === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'

  let scanned = 0
  let purged = 0
  const failures: string[] = []

  try {
    const snap = await adminDb.collection('verification_requests').get()

    for (const doc of snap.docs) {
      const data = (doc.data() || {}) as any
      const path = data?.files?.liveness?.path
      if (!path) continue
      scanned++

      const status = String(data?.status || '').toLowerCase()
      if (!DECIDED.has(status)) continue

      // When the decision landed. Falls back to the upload time so a request
      // decided before this field existed still ages out.
      const decidedAtRaw =
        data?.reviewedAt || data?.decidedAt || data?.updatedAt || data?.files?.liveness?.uploadedAt
      const decidedAt = decidedAtRaw?.toDate
        ? decidedAtRaw.toDate()
        : decidedAtRaw
        ? new Date(decidedAtRaw)
        : null
      if (!decidedAt || Number.isNaN(decidedAt.getTime())) continue
      if (decidedAt.getTime() > cutoff) continue

      // The path is client-written (the user's own request doc), so it is only
      // trusted inside that user's own verification folder. Anything else —
      // another user's file, an event poster, `../` tricks — is skipped, never
      // deleted with the service account's authority.
      const objectPath = String(path)
      const ownPrefix = `verification/${doc.id}/`
      if (
        !objectPath.startsWith(ownPrefix) ||
        objectPath.length === ownPrefix.length ||
        objectPath.includes('\\') ||
        objectPath.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
      ) {
        failures.push(`${doc.id}: path outside verification/${doc.id}/, skipped`)
        continue
      }

      if (dryRun) {
        purged++
        continue
      }

      try {
        await adminStorage.bucket().file(objectPath).delete({ ignoreNotFound: true })
        // Drop the pointer too, and record WHY it is gone — a reviewer opening
        // an old case should see a retention deletion, not a missing file.
        await doc.ref.set(
          {
            files: {
              ...(data.files || {}),
              liveness: {
                ...(data.files?.liveness || {}),
                path: null,
                purgedAt: new Date().toISOString(),
                purgedReason: `retention_${RETENTION_DAYS}d`,
              },
            },
          },
          { merge: true }
        )
        purged++
      } catch (e: any) {
        failures.push(`${doc.id}: ${e?.message || 'delete failed'}`)
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      retentionDays: RETENTION_DAYS,
      scanned,
      purged,
      failures,
    })
  } catch (error: any) {
    console.error('[purge-liveness] failed', error?.message)
    return NextResponse.json({ error: 'Purge failed' }, { status: 500 })
  }
}
