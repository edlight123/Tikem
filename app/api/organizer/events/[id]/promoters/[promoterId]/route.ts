// Edit or remove one promoter. Terms changes affect FUTURE sales only (type +
// value are snapshotted onto every promoter_sales row at fulfillment). A promoter
// with recorded orders can only be deactivated, never deleted — the ledger must
// stay reconcilable against a real record.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { maxTierPriceCentsForEvent, normalizePromoterCode } from '@/lib/promoters'

async function loadOwnedPromoter(eventId: string, promoterId: string, userId: string): Promise<
  | { ok: true; ref: FirebaseFirestore.DocumentReference; data: any; event: any }
  | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }

  const ref = adminDb.collection('event_promoters').doc(promoterId)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false, status: 404, error: 'Promoter not found' }
  const data = snap.data() as any
  if (String(data.event_id) !== String(eventId)) {
    return { ok: false, status: 404, error: 'Promoter not found' }
  }
  return { ok: true, ref, data, event: eventData }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; promoterId: string }> }
) {
  try {
    const { id, promoterId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedPromoter(id, promoterId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    const body = await request.json().catch(() => ({}))
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }

    if (body?.name !== undefined) {
      const name = String(body.name || '').trim()
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      updates.name = name
    }
    if (body?.contact !== undefined) {
      updates.contact = String(body.contact || '').trim() || null
    }
    if (body?.isActive !== undefined) {
      updates.is_active = Boolean(body.isActive)
    }
    if (body?.code !== undefined) {
      const code = normalizePromoterCode(body.code)
      if (!code) {
        return NextResponse.json(
          { error: 'Code must be 2–24 letters, numbers, dashes or underscores' },
          { status: 400 }
        )
      }
      if (code !== loaded.data.code) {
        const existing = await adminDb
          .collection('event_promoters')
          .where('event_id', '==', id)
          .where('code', '==', code)
          .limit(1)
          .get()
        if (!existing.empty) {
          return NextResponse.json({ error: 'This code is already used on this event' }, { status: 400 })
        }
        updates.code = code
      }
    }
    if (body?.commissionType !== undefined || body?.commissionValue !== undefined) {
      const commissionType =
        (body?.commissionType ?? loaded.data.commission_type) === 'flat_per_ticket'
          ? 'flat_per_ticket'
          : 'percentage'
      const rawValue =
        body?.commissionValue !== undefined
          ? Number(body.commissionValue)
          : commissionType === 'flat_per_ticket'
          ? Number(loaded.data.commission_value) / 100
          : Number(loaded.data.commission_value)
      if (!Number.isFinite(rawValue) || rawValue < 0) {
        return NextResponse.json({ error: 'Commission must be a non-negative number' }, { status: 400 })
      }
      if (commissionType === 'percentage' && rawValue > 50) {
        return NextResponse.json({ error: 'Commission percentage is capped at 50%' }, { status: 400 })
      }
      if (commissionType === 'flat_per_ticket') {
        // Same guard as create: a flat fee above the priciest ticket is never earnable.
        const maxTierCents = await maxTierPriceCentsForEvent(id, loaded.event)
        if (maxTierCents !== null && Math.round(rawValue * 100) > maxTierCents) {
          return NextResponse.json(
            { error: 'A flat commission cannot be more than the ticket price' },
            { status: 400 }
          )
        }
      }
      updates.commission_type = commissionType
      updates.commission_value =
        commissionType === 'flat_per_ticket' ? Math.round(rawValue * 100) : rawValue
    }

    await loaded.ref.update(updates)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[promoters] update failed', err)
    return NextResponse.json({ error: 'Failed to update promoter' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; promoterId: string }> }
) {
  try {
    const { id, promoterId } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const loaded = await loadOwnedPromoter(id, promoterId, user.id)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

    if ((Number(loaded.data.orders_count) || 0) > 0) {
      return NextResponse.json(
        { error: 'This promoter has recorded sales. Deactivate them instead of deleting.' },
        { status: 409 }
      )
    }

    await loaded.ref.delete()
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[promoters] delete failed', err)
    return NextResponse.json({ error: 'Failed to delete promoter' }, { status: 500 })
  }
}
