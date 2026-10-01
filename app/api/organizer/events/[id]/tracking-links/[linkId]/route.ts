// Rename or remove one tracking link. The utm parts and URL are fixed at
// creation — the URL has already been shared, so changing what it says would
// split one link's numbers across two meanings. Removing a link stops new
// clicks counting; tickets already sold keep their attribution stamp.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  TRACKING_LINKS_COLLECTION,
  assertEventOwnedByUser,
  serializeTrackingLink,
} from '@/lib/tracking-links'

async function loadOwnedLink(eventId: string, linkId: string, userId: string) {
  const ownership = await assertEventOwnedByUser(eventId, userId)
  if (!ownership.ok) return ownership
  const ref = adminDb.collection(TRACKING_LINKS_COLLECTION).doc(linkId)
  const snap = await ref.get()
  if (!snap.exists || String((snap.data() as any)?.event_id) !== String(eventId)) {
    return { ok: false as const, status: 404, error: 'Tracking link not found' }
  }
  return { ok: true as const, ref, data: snap.data() as any }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { id, linkId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedLink(id, linkId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    const body = await request.json().catch(() => ({}))
    const label = String(body?.label || '').trim().slice(0, 80)
    if (!label) return NextResponse.json({ error: 'Label is required' }, { status: 400 })

    const updates = { label, updated_at: new Date().toISOString() }
    await loaded.ref.update(updates)
    return NextResponse.json({ success: true, link: serializeTrackingLink(linkId, { ...loaded.data, ...updates }) })
  } catch (err: any) {
    console.error('[tracking-links] update failed', err)
    return NextResponse.json({ error: 'Failed to update tracking link' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { id, linkId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedLink(id, linkId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    await loaded.ref.delete()
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[tracking-links] delete failed', err)
    return NextResponse.json({ error: 'Failed to delete tracking link' }, { status: 500 })
  }
}
