/**
 * POST /api/admin/community/claims/:id  { action: 'approve' | 'reject' }  (admins only)
 *
 * Approve moves the event to the claiming org (lib/community/submissions
 * claimTransferPatch): organizer_id and name change, it stops being claimable,
 * and the community credit and link-out go, so the organizer can edit it and
 * sell. A claimant whose own account is the org and who is still an attendee
 * becomes an organizer. Other pending claims on the same event are closed.
 */
import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { orgDisplayName } from '@/lib/organizer/context'
import { updateUserRole } from '@/lib/firestore/user-profile-server'
import { claimTransferPatch } from '@/lib/community/submissions'
import { notifyCommunityMember } from '@/lib/community/notify'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  const { id } = await params
  const ref = adminDb.collection('event_claims').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const claim: any = snap.data()
  if (claim.status !== 'pending') return NextResponse.json({ error: 'Already handled', code: 'not_pending' }, { status: 409 })
  const body = await request.json().catch(() => null)
  const now = new Date().toISOString()
  const decided = { decided_by: user.id, decided_at: now, updated_at: now }

  if (body?.action === 'reject') {
    await ref.update({ status: 'rejected', ...decided })
    await notifyCommunityMember({ userId: claim.requested_by, outcome: 'claim_rejected', eventId: claim.event_id, eventTitle: String(claim.event_title || '') })
    return NextResponse.json({ ok: true })
  }
  if (body?.action !== 'approve') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const eventRef = adminDb.collection('events').doc(claim.event_id)
  const ev = await eventRef.get()
  if (!ev.exists || ev.data()?.claimable !== true) {
    return NextResponse.json({ error: 'Event is no longer claimable', code: 'not_claimable' }, { status: 409 })
  }
  const orgId = String(claim.org_id || '')
  if (!orgId) return NextResponse.json({ error: 'Claim has no organization', code: 'invalid_claim' }, { status: 400 })

  // A person claiming for their own account gets organizer access (only ever
  // an upgrade from attendee; updateUserRole never touches admins).
  if (orgId === claim.requested_by) {
    const owner = await adminDb.collection('users').doc(orgId).get()
    if (owner.exists && String(owner.data()?.role || 'attendee') === 'attendee') {
      const r = await updateUserRole(orgId, 'organizer')
      if (!r.success) return NextResponse.json({ error: 'Could not set up organizer access' }, { status: 500 })
    }
  }

  const orgName = (await orgDisplayName(orgId)) || String(claim.org_name || '')
  const others = await adminDb.collection('event_claims').where('event_id', '==', claim.event_id).where('status', '==', 'pending').get()

  const batch = adminDb.batch()
  batch.update(eventRef, claimTransferPatch(orgId, orgName, now, FieldValue.delete()))
  batch.update(ref, { status: 'approved', ...decided })
  for (const d of others.docs as any[]) {
    if (d.id !== id) batch.update(d.ref, { status: 'superseded', ...decided })
  }
  await batch.commit()
  await notifyCommunityMember({ userId: claim.requested_by, outcome: 'claim_approved', eventId: claim.event_id, eventTitle: String(claim.event_title || '') })
  return NextResponse.json({ ok: true })
}
