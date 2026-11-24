/**
 * "Is this your event? Claim it" on a community-shared event
 * (lib/community/submissions).
 *
 * GET  /api/events/:id/claim  → { claimable, claim: { status } | null } for the viewer
 * POST /api/events/:id/claim  { method, instagram_handle?, proof_url?, proof_path?, message? }
 *
 * The claimant asks for the event to move to their organization and sends a
 * proof: an Instagram handle (the admin sees whether it matches the handle
 * credited on the event), a link, or an uploaded file. An uploaded proof is a
 * storage PATH under the caller's own PRIVATE claim-proofs/{uid}/ folder
 * (lib/community/claim-proofs; storage.rules allow no client read), checked
 * here to exist. An admin decides (/admin/community).
 *
 * Which org: the acting org when the caller may manage events there; else the
 * caller's own account, which becomes an organizer account when the claim is
 * approved. One claim per org per event (event_claims/{eventId}__{orgId},
 * server-only collection).
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { getOrgContext, orgDisplayName } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'
import { consumeRateLimit } from '@/lib/rate-limit'
import { CLAIM_LIMIT_PER_USER, handleMatches, isBannedProfile, parseClaimInput } from '@/lib/community/submissions'
import { claimProofExists, isClaimProofPathFor } from '@/lib/community/claim-proofs'
import { notifyAdminsOfCommunity } from '@/lib/community/notify'

export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000

async function claimingOrg(userId: string): Promise<string> {
  const ctx = await getOrgContext()
  return ctx && orgCan(ctx.role, 'manage_events') ? ctx.orgId : userId
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb.collection('events').doc(id).get()
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const claimable = snap.data()?.claimable === true
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ claimable, claim: null })
  const orgId = await claimingOrg(user.id)
  const existing = await adminDb.collection('event_claims').doc(`${id}__${orgId}`).get()
  return NextResponse.json({ claimable, claim: existing.exists ? { status: String(existing.data()?.status || '') } : null })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to claim this event.', code: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const profile = await adminDb.collection('users').doc(user.id).get()
  if (isBannedProfile(profile.exists ? profile.data() : null)) {
    return NextResponse.json({ error: 'This account cannot claim events.', code: 'forbidden' }, { status: 403 })
  }

  const snap = await adminDb.collection('events').doc(id).get()
  const event: any = snap.exists ? snap.data() : null
  if (!event) return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  if (event.claimable !== true) return NextResponse.json({ error: 'This event cannot be claimed.', code: 'not_claimable' }, { status: 409 })

  const body = await request.json().catch(() => null)
  const parsed = parseClaimInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 })
  const claim = parsed.value
  if (claim.proof_path) {
    // Only the caller's own private folder, and only a file that is really there.
    if (!isClaimProofPathFor(claim.proof_path, user.id) || !(await claimProofExists(claim.proof_path))) {
      return NextResponse.json({ error: 'Upload the proof again.', code: 'invalid_proof' }, { status: 400 })
    }
  }

  const orgId = await claimingOrg(user.id)
  const ref = adminDb.collection('event_claims').doc(`${id}__${orgId}`)
  const existing = await ref.get()
  if (existing.exists && existing.data()?.status === 'pending') return NextResponse.json({ ok: true, already: true })

  const { limited } = await consumeRateLimit({ key: `community-claim:user:${user.id}`, limit: CLAIM_LIMIT_PER_USER, windowMs: DAY })
  if (limited) return NextResponse.json({ error: 'Too many claims today. Try again tomorrow.', code: 'rate_limited' }, { status: 429 })

  const now = new Date().toISOString()
  await ref.set({
    status: 'pending',
    event_id: id,
    event_title: String(event.title || ''),
    source_name: String(event.source_name || ''),
    source_handle: String(event.source_handle || ''),
    org_id: orgId,
    org_name: (await orgDisplayName(orgId)) || String(user.full_name || ''),
    requested_by: user.id,
    requested_by_email: user.email || '',
    method: claim.method,
    instagram_handle: claim.instagram_handle || null,
    handle_matches: handleMatches(claim.instagram_handle, event.source_handle),
    proof_url: claim.proof_url || null,
    proof_path: claim.proof_path || null,
    message: claim.message,
    created_at: now,
    updated_at: now,
  })
  await notifyAdminsOfCommunity({ kind: 'claim', title: String(event.title || '') })
  return NextResponse.json({ ok: true }, { status: 201 })
}
