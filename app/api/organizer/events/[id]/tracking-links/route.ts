// Organizer-owned tracking links for one event: list them with their live
// counters, and create new ones. Counters (clicks, sales_count, tickets_count,
// revenue_by_currency) are written ONLY by the click endpoint and fulfillment
// via the Admin SDK; nothing a client sends here can set them.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { buildTrackingUrl, cleanUtmValue } from '@/lib/attribution'
import {
  TRACKING_LINKS_COLLECTION,
  assertEventOwnedByUser,
  serializeTrackingLink,
} from '@/lib/tracking-links'

const MAX_LINKS_PER_EVENT = 200
const LABEL_MAX = 80
const IMPORT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Share links always go out on www: the apex 308s and some clients drop the query. */
function shareOrigin(request: Request): string {
  return new URL(request.url).origin.replace('://tikem.co', '://www.tikem.co')
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ownership = await assertEventOwnedByUser(id, user.id)
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })

    // Equality-only query (no composite index); newest first, sorted here.
    const snap = await adminDb
      .collection(TRACKING_LINKS_COLLECTION)
      .where('event_id', '==', id)
      .limit(MAX_LINKS_PER_EVENT)
      .get()

    const links = snap.docs
      .map((d: any) => serializeTrackingLink(d.id, d.data()))
      .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    return NextResponse.json({ links })
  } catch (err: any) {
    console.error('[tracking-links] list failed', err)
    return NextResponse.json({ error: 'Failed to load tracking links' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ownership = await assertEventOwnedByUser(id, user.id)
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })

    const body = await request.json().catch(() => ({}))
    const label = String(body?.label || '').trim().slice(0, LABEL_MAX)
    const source = cleanUtmValue(body?.source)
    const medium = cleanUtmValue(body?.medium) || ''
    const campaign = cleanUtmValue(body?.campaign) || ''
    if (!label) return NextResponse.json({ error: 'Label is required' }, { status: 400 })
    if (!source) return NextResponse.json({ error: 'Source is required' }, { status: 400 })

    // One-time migration of links a device kept locally: the device's own id is
    // sent as importKey so a retried upload never creates the link twice.
    const importKey = IMPORT_KEY_PATTERN.test(String(body?.importKey || ''))
      ? String(body.importKey)
      : null
    const collection = adminDb.collection(TRACKING_LINKS_COLLECTION)

    if (importKey) {
      const existing = await collection
        .where('event_id', '==', id)
        .where('import_key', '==', importKey)
        .limit(1)
        .get()
      if (!existing.empty) {
        const d = existing.docs[0]
        return NextResponse.json({ success: true, link: serializeTrackingLink(d.id, d.data()), imported: false })
      }
    }

    const count = await collection.where('event_id', '==', id).count().get().catch(() => null)
    if (count && Number(count.data()?.count) >= MAX_LINKS_PER_EVENT) {
      return NextResponse.json({ error: 'Too many tracking links on this event' }, { status: 400 })
    }

    const ref = collection.doc()
    const base = `${shareOrigin(request)}/events/${encodeURIComponent(id)}`
    const now = new Date().toISOString()
    const createdAt =
      importKey && typeof body?.createdAt === 'number' && Number.isFinite(body.createdAt)
        ? new Date(Math.min(body.createdAt, Date.now())).toISOString()
        : now
    const data = {
      event_id: id,
      organizer_id: user.id,
      label,
      source,
      medium,
      campaign,
      url: buildTrackingUrl(base, { source, medium, campaign, id: ref.id }),
      created_by: user.id,
      created_at: createdAt,
      updated_at: now,
      import_key: importKey,
      clicks: 0,
      sales_count: 0,
      tickets_count: 0,
      revenue_by_currency: {},
    }
    await ref.set(data)

    return NextResponse.json(
      { success: true, link: serializeTrackingLink(ref.id, data), imported: Boolean(importKey) },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('[tracking-links] create failed', err)
    return NextResponse.json({ error: 'Failed to create tracking link' }, { status: 500 })
  }
}
