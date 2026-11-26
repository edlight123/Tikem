/**
 * Backfill `timezone` on events saved before the composer stored it
 * (lib/events/timezone-backfill). Dev-tools admins only.
 *
 *   GET                         → usage
 *   POST { dryRun: true, ... }  → what would change (always run this first)
 *   POST { dryRun: false, ... } → write it
 *
 * Pages through every event by document id; pass `startAfterId` from the
 * previous response's `next` to continue. Only `timezone` is written: the
 * stored instants stay as they are, and every reader already fell back to this
 * same zone, so no displayed time changes.
 */
import { NextRequest } from 'next/server'
import { FieldPath } from 'firebase-admin/firestore'
import { requireDevTools } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { timezoneBackfillFor } from '@/lib/events/timezone-backfill'

export const runtime = 'nodejs'

type BackfillRequest = {
  dryRun?: boolean
  /** Max documents to scan in this call (1–5000, default 500). */
  limit?: number
  /** Pagination cursor: the last document id the previous call scanned. */
  startAfterId?: string
}

export async function GET() {
  try {
    const { user, error } = await requireDevTools()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }
    return adminOk({
      message:
        'POST to run. Start with dryRun=true and read `examples`; then dryRun=false. Continue with startAfterId from `next` until it is null.',
      usage: {
        method: 'POST',
        url: '/api/admin/events/backfill-timezone',
        bodyExamples: [
          { dryRun: true, limit: 500 },
          { dryRun: false, limit: 500 },
          { dryRun: false, limit: 500, startAfterId: 'lastIdFromPreviousRun' },
        ],
      },
    })
  } catch (err: any) {
    console.error('Backfill timezone GET error:', err)
    return adminError('Internal server error', 500, err?.message || String(err))
  }
}

export async function POST(request: NextRequest) {
  try {
    // An admin with dev tools, or a server job holding CRON_SECRET (like the
    // other backfills: backfill-published-at, backfill-categories).
    const cron = process.env.CRON_SECRET
    const viaCron = !!cron && request.headers.get('authorization') === `Bearer ${cron}`
    const { user, error } = viaCron ? { user: { id: 'cron', email: 'cron' } as any, error: null } : await requireDevTools()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }

    const body = (await request.json().catch(() => ({}))) as BackfillRequest
    // Anything but an explicit false is a dry run: a write is never the default.
    const dryRun = body?.dryRun !== false
    const limit = Math.min(Math.max(Number(body?.limit || 500), 1), 5000)
    const startAfterId = String(body?.startAfterId || '').trim()

    let scanned = 0
    let toSet = 0
    let skipped = 0
    let written = 0
    let lastId: string | null = startAfterId || null
    const byZone: Record<string, number> = {}
    const examples: Array<{ id: string; title?: string; city?: string; country?: string; from: string | null; timezone: string }> = []

    let exhausted = false
    // Firestore batches hold 500 writes; pages are the same size.
    while (scanned < limit) {
      const pageSize = Math.min(500, limit - scanned)
      let query = adminDb.collection('events').orderBy(FieldPath.documentId()).limit(pageSize)
      if (lastId) query = query.startAfter(lastId)
      const snap = await query.get()
      if (snap.empty) {
        exhausted = true
        break
      }
      const batch = adminDb.batch()
      let ops = 0
      for (const doc of snap.docs) {
        scanned += 1
        const data: any = doc.data() || {}
        const plan = timezoneBackfillFor(data)
        if (plan.action === 'skip') {
          skipped += 1
          continue
        }
        toSet += 1
        byZone[plan.timezone] = (byZone[plan.timezone] || 0) + 1
        if (examples.length < 25) {
          examples.push({ id: doc.id, title: data.title, city: data.city, country: data.country, from: plan.from, timezone: plan.timezone })
        }
        if (!dryRun) {
          batch.update(doc.ref, { timezone: plan.timezone })
          ops += 1
        }
      }
      if (!dryRun && ops > 0) {
        await batch.commit()
        written += ops
      }
      lastId = snap.docs[snap.docs.length - 1].id
      if (snap.size < pageSize) {
        // The collection ran out before the limit.
        exhausted = true
        break
      }
    }

    await logAdminAction({
      action: 'admin.backfill',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceType: 'events',
      details: { name: 'events.backfill-timezone', dryRun, limit, startAfterId: startAfterId || null, scanned, toSet, skipped, written },
    })

    return adminOk({
      dryRun,
      limit,
      startAfterId: startAfterId || null,
      scanned,
      // Events missing a (valid) zone, and how many were written this call.
      toSet,
      written,
      skipped,
      byZone,
      examples,
      next: !exhausted && lastId ? { startAfterId: lastId } : null,
    })
  } catch (err: any) {
    console.error('Backfill timezone error:', err)
    return adminError('Internal server error', 500, err?.message || String(err))
  }
}
