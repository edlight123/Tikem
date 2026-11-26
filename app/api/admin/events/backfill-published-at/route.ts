/**
 * POST /api/admin/events/backfill-published-at (admin, or CRON_SECRET bearer)
 *
 * One-off: give every currently published event that has no `published_at`
 * (lib/events/publishedAt) its best-known publish time: `live_email_sent_at`
 * (stamped when it first went live), else `created_at`. Home's "Recently
 * added" rail reads published_at; new publishes stamp it themselves.
 *
 * Body: { dryRun?: boolean (default true), limit?: number (default 500, max 2000),
 *         startAfter?: string (the `next` of the previous page) }
 * Start with dryRun (lists what would change), then dryRun: false, following
 * `next` until it comes back null.
 */
import { NextRequest } from 'next/server'
import { FieldPath } from 'firebase-admin/firestore'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { backfillPublishedAt } from '@/lib/events/publishedAt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function authorize(request: NextRequest): Promise<{ id: string; email: string } | null> {
  const cron = process.env.CRON_SECRET
  if (cron && request.headers.get('authorization') === `Bearer ${cron}`) return { id: 'cron', email: 'cron' }
  const { user } = await requireAdmin()
  return user ? { id: user.id, email: user.email || 'unknown' } : null
}

export async function POST(request: NextRequest) {
  const admin = await authorize(request)
  if (!admin) return adminError('Unauthorized', 401)
  try {
    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; limit?: number; startAfter?: string }
    const dryRun = body?.dryRun !== false
    const limit = Math.min(Math.max(Number(body?.limit || 500), 1), 2000)

    let q = adminDb.collection('events').where('is_published', '==', true).orderBy(FieldPath.documentId()).limit(limit)
    if (typeof body?.startAfter === 'string' && body.startAfter) q = q.startAfter(body.startAfter)
    const snap = await q.get()

    const changes: Array<{ id: string; title: string; published_at: string; from: string }> = []
    for (const d of snap.docs) {
      const e = d.data() || {}
      const fix = backfillPublishedAt(e)
      if (!fix) continue
      changes.push({ id: d.id, title: String(e.title || '').slice(0, 80), published_at: fix.published_at, from: fix.from })
    }

    if (!dryRun && changes.length) {
      for (let i = 0; i < changes.length; i += 400) {
        const batch = adminDb.batch()
        for (const c of changes.slice(i, i + 400)) {
          // Only the stamp: updated_at is left alone (nothing the organizer sees changed).
          batch.set(adminDb.collection('events').doc(c.id), { published_at: c.published_at }, { merge: true })
        }
        await batch.commit()
      }
      await logAdminAction({
        action: 'admin.backfill',
        adminId: admin.id,
        adminEmail: admin.email,
        resourceType: 'events',
        details: { name: 'events.backfill-published-at', updated: changes.length },
      }).catch(() => {})
    }

    const last = snap.docs[snap.docs.length - 1]
    return adminOk({
      dryRun,
      scanned: snap.size,
      changed: changes.length,
      byLiveEmail: changes.filter((c) => c.from === 'live_email_sent_at').length,
      byCreatedAt: changes.filter((c) => c.from === 'created_at').length,
      changes: changes.slice(0, 200),
      next: snap.size === limit && last ? last.id : null,
    })
  } catch (e: any) {
    console.error('backfill-published-at failed:', e)
    return adminError('Internal server error', 500, e?.message || String(e))
  }
}
