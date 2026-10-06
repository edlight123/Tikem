// Organizer-managed promoters for one event: list them (with their live stats and
// links) and create new ones. The same ownership discipline as promo codes; the
// counters on each doc are written only by the Admin SDK at fulfillment.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  maxTierPriceCentsForEvent,
  mintPromoterStatsKey,
  normalizePromoterCode,
  promoterTokenFor,
} from '@/lib/promoters'

async function assertEventOwnedByUser(eventId: string, userId: string): Promise<
  { ok: true; event: any } | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }
  return { ok: true, event: eventData }
}

function serializePromoter(id: string, data: any, origin: string) {
  return {
    id,
    code: data.code,
    name: data.name,
    contact: data.contact || null,
    commissionType: data.commission_type === 'flat_per_ticket' ? 'flat_per_ticket' : 'percentage',
    commissionValue: Number(data.commission_value) || 0,
    isActive: data.is_active !== false,
    claimed: Boolean(data.claimed_by_uid),
    ticketsSold: Number(data.tickets_sold) || 0,
    ordersCount: Number(data.orders_count) || 0,
    // Link visits, counted by /api/track/click (deduped per browser per 30 min).
    clicks: Number(data.clicks) || 0,
    grossCents: Number(data.gross_cents) || 0,
    commissionCents: Number(data.commission_cents) || 0,
    currency: data.currency || 'HTG',
    shareUrl: `${origin}/events/${data.event_id}?ref=${encodeURIComponent(data.code)}`,
    statsUrl: `${origin}/promoter/${encodeURIComponent(promoterTokenFor(String(data.stats_key || '')))}`,
    createdAt: data.created_at || null,
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ownership = await assertEventOwnedByUser(id, user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const snap = await adminDb
      .collection('event_promoters')
      .where('event_id', '==', id)
      .orderBy('created_at', 'desc')
      .limit(200)
      .get()

    const origin = new URL(request.url).origin
    const promoters = snap.docs.map((d: any) => serializePromoter(d.id, d.data(), origin))
    return NextResponse.json({ promoters })
  } catch (err: any) {
    console.error('[promoters] list failed', err)
    return NextResponse.json({ error: 'Failed to load promoters' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'organizer' && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const ownership = await assertEventOwnedByUser(id, user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const body = await request.json().catch(() => ({}))
    const name = String(body?.name || '').trim()
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const code = normalizePromoterCode(body?.code)
    if (!code) {
      return NextResponse.json(
        { error: 'Code must be 2–24 letters, numbers, dashes or underscores' },
        { status: 400 }
      )
    }

    const commissionType = body?.commissionType === 'flat_per_ticket' ? 'flat_per_ticket' : 'percentage'
    const commissionValue = Number(body?.commissionValue)
    if (!Number.isFinite(commissionValue) || commissionValue < 0) {
      return NextResponse.json({ error: 'Commission must be a non-negative number' }, { status: 400 })
    }
    if (commissionType === 'percentage' && commissionValue > 50) {
      return NextResponse.json({ error: 'Commission percentage is capped at 50%' }, { status: 400 })
    }
    if (commissionType === 'flat_per_ticket') {
      // A flat fee above the priciest ticket can never be earned in full; it only
      // ever reads as "the whole sale goes to the promoter". Per-order the
      // commission is also capped at the gross minus Tikèm's fee
      // (calculateCommissionCents), so this is the up-front guard.
      const maxTierCents = await maxTierPriceCentsForEvent(id, ownership.event)
      // No known ticket price = no cap to check against: refuse rather than
      // accept an uncapped flat fee.
      if (maxTierCents === null) {
        return NextResponse.json(
          {
            error: 'Add a paid ticket tier before setting a flat commission, or use a percentage commission.',
            code: 'flat_commission_needs_price',
          },
          { status: 400 }
        )
      }
      if (Math.round(commissionValue * 100) > maxTierCents) {
        return NextResponse.json(
          { error: 'A flat commission cannot be more than the ticket price' },
          { status: 400 }
        )
      }
    }

    // One code per event — same dupe rule as promo codes.
    const existing = await adminDb
      .collection('event_promoters')
      .where('event_id', '==', id)
      .where('code', '==', code)
      .limit(1)
      .get()
    if (!existing.empty) {
      return NextResponse.json({ error: 'This code is already used on this event' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const promoterData = {
      event_id: id,
      organizer_id: user.id,
      code,
      name,
      contact: String(body?.contact || '').trim() || null,
      commission_type: commissionType,
      // Percentage as given; flat amounts arrive in MAJOR units and are stored in cents.
      commission_value:
        commissionType === 'flat_per_ticket' ? Math.round(commissionValue * 100) : commissionValue,
      is_active: true,
      stats_key: mintPromoterStatsKey(),
      claimed_by_uid: null,
      tickets_sold: 0,
      orders_count: 0,
      gross_cents: 0,
      commission_cents: 0,
      currency: String(ownership.event?.currency || 'HTG').toUpperCase(),
      created_at: now,
      updated_at: now,
    }

    const ref = await adminDb.collection('event_promoters').add(promoterData)
    const origin = new URL(request.url).origin
    return NextResponse.json(
      { success: true, promoter: serializePromoter(ref.id, promoterData, origin) },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('[promoters] create failed', err)
    return NextResponse.json({ error: 'Failed to create promoter' }, { status: 500 })
  }
}
