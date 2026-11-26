/**
 * POST /api/admin/community/submissions/:id   (admins only)
 *   { action: 'approve', fields }      publish, edited by the admin
 *   { action: 'reject', reason? }
 *   { action: 'merge', event_id }      a duplicate of an event already on Tikèm
 *
 * Approve publishes the event (lib/community/submissions submissionToEvent):
 * owned by the Tikèm Community account (lib/community/org), credited "From
 * <organizer>" with the source link, claimable, selling nothing on Tikèm. The
 * member who shared it hears it went live (lib/community/notify).
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { parseSubmissionFields, submissionToEvent } from '@/lib/community/submissions'
import { ensureCommunityOrg } from '@/lib/community/org'
import { notifyCommunityMember } from '@/lib/community/notify'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  const { id } = await params
  const ref = adminDb.collection('event_submissions').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sub: any = snap.data()
  const body = await request.json().catch(() => null)
  const now = new Date().toISOString()
  const decided = { decided_by: user.id, decided_at: now, updated_at: now }

  // Take down a share that went live on its own (lib/community/publish): the
  // event is unpublished, the share is marked removed (which also holds that
  // account's next shares for review: lib/community/trust past_removals).
  if (body?.action === 'remove') {
    if (sub.status !== 'approved' || !sub.event_id) {
      return NextResponse.json({ error: 'Only a live share can be removed.', code: 'not_live' }, { status: 409 })
    }
    const batch = adminDb.batch()
    batch.update(adminDb.collection('events').doc(String(sub.event_id)), {
      is_published: false,
      status: 'removed',
      rejected: true,
      updated_at: now,
    })
    batch.update(ref, { status: 'removed', remove_reason: String(body?.reason || '').trim().slice(0, 300), ...decided })
    await batch.commit()
    return NextResponse.json({ ok: true })
  }

  if (sub.status !== 'pending') return NextResponse.json({ error: 'Already handled', code: 'not_pending' }, { status: 409 })

  if (body?.action === 'reject') {
    await ref.update({ status: 'rejected', reject_reason: String(body?.reason || '').trim().slice(0, 300), ...decided })
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'merge') {
    const target = String(body?.event_id || '').trim()
    if (!target || target.includes('/')) return NextResponse.json({ error: 'Give the event id it duplicates.', code: 'invalid_event' }, { status: 400 })
    const ev = await adminDb.collection('events').doc(target).get()
    if (!ev.exists) return NextResponse.json({ error: 'No event with that id.', code: 'invalid_event' }, { status: 404 })
    await ref.update({ status: 'merged', merged_into: target, ...decided })
    await notifyCommunityMember({ userId: sub.submitted_by, outcome: 'merged', eventId: target, eventTitle: String(ev.data()?.title || '') })
    return NextResponse.json({ ok: true, eventId: target })
  }

  if (body?.action !== 'approve') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const parsed = parseSubmissionFields(body?.fields)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'invalid_fields', field: parsed.field }, { status: 400 })
  const event = submissionToEvent(parsed.value, {
    submissionId: id,
    bannerUrl: sub.image_url || null,
    communityOrgId: await ensureCommunityOrg(now),
    now,
  })
  if (!event) return NextResponse.json({ error: 'Check the date and time.', code: 'invalid_fields', field: 'date' }, { status: 400 })

  const eventRef = adminDb.collection('events').doc()
  const batch = adminDb.batch()
  batch.set(eventRef, { ...event, created_by: user.id })
  batch.update(ref, { status: 'approved', event_id: eventRef.id, ...decided })
  await batch.commit()
  await notifyCommunityMember({ userId: sub.submitted_by, outcome: 'published', eventId: eventRef.id, eventTitle: event.title })
  return NextResponse.json({ ok: true, eventId: eventRef.id })
}
