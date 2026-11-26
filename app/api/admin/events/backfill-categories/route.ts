/**
 * POST /api/admin/events/backfill-categories (admin, or CRON_SECRET bearer)
 *
 * One-off: give existing events the category imports now infer
 * (lib/events/categoryInfer). Fills events with no category at all, and
 * imported events still on the old blanket 'Other' (Eventbrite, link and feed
 * imports), so they show in the home category rails. A category an organizer
 * picked is never changed (categoryBackfillFor).
 *
 * Body: { dryRun?: boolean (default true), limit?: number (default 500, max 2000),
 *         startAfter?: string (the `next` of the previous page), orgId?: string }
 * Start with dryRun (lists what would change), then dryRun: false, following
 * `next` until it comes back null.
 */
import { NextRequest } from 'next/server'
import { FieldPath } from 'firebase-admin/firestore'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { categoryBackfillFor } from '@/lib/events/categoryInfer'

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
    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; limit?: number; startAfter?: string; orgId?: string }
    const dryRun = body?.dryRun !== false
    const limit = Math.min(Math.max(Number(body?.limit || 500), 1), 2000)

    const base =
      typeof body?.orgId === 'string' && body.orgId
        ? adminDb.collection('events').where('organizer_id', '==', body.orgId)
        : adminDb.collection('events')
    let q = base.orderBy(FieldPath.documentId()).limit(limit)
    if (typeof body?.startAfter === 'string' && body.startAfter) q = q.startAfter(body.startAfter)
    const snap = await q.get()

    const changes: Array<{ id: string; title: string; from: string | null; to: string }> = []
    for (const d of snap.docs) {
      const e = d.data() || {}
      const fix = categoryBackfillFor(e)
      if (!fix) continue
      changes.push({ id: d.id, title: String(e.title || '').slice(0, 80), from: e.category ? String(e.category) : null, to: fix.category })
    }

    if (!dryRun && changes.length) {
      const now = new Date().toISOString()
      for (let i = 0; i < changes.length; i += 400) {
        const batch = adminDb.batch()
        for (const c of changes.slice(i, i + 400)) {
          batch.set(adminDb.collection('events').doc(c.id), { category: c.to, category_auto: true, updated_at: now }, { merge: true })
        }
        await batch.commit()
      }
      await logAdminAction({
        action: 'admin.backfill',
        adminId: admin.id,
        adminEmail: admin.email,
        resourceType: 'events',
        details: { name: 'events.backfill-categories', updated: changes.length },
      }).catch(() => {})
    }

    const last = snap.docs[snap.docs.length - 1]
    return adminOk({
      dryRun,
      scanned: snap.size,
      changed: changes.length,
      byCategory: changes.reduce<Record<string, number>>((m, c) => {
        m[c.to] = (m[c.to] || 0) + 1
        return m
      }, {}),
      changes: changes.slice(0, 200),
      next: snap.size === limit && last ? last.id : null,
    })
  } catch (err: any) {
    console.error('backfill-categories error:', err)
    return adminError('Internal server error', 500, err?.message || String(err))
  }
}
