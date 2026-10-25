import { NextRequest, NextResponse, after } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { teamInviteEmail } from '@/lib/email-templates/teamInvite'
import { isTeamRole } from '@/lib/organizer/teamRoles'
import {
  ORG_INVITES,
  activateMember,
  deactivateMember,
  orgDisplayName,
  requireOrg,
  teamCol,
} from '@/lib/organizer/context'
import { randomToken, sha256Hex } from '@/app/api/staff/_utils'
import { INVITE_PREFIX, iso, roster, type RosterRow } from '@/lib/organizer/teamRoster'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Organization team (lib/organizer/teamRoles.ts for what each role may do).
 *
 *   GET     roster: active members + open invites
 *   POST    { email, name?, role } invite by email (7-day accept link)
 *   PATCH   { memberId, role }     change a role
 *   DELETE  ?memberId=             remove a member / revoke an invite
 *
 * The owner and the org's admins manage the team; nobody can touch the owner,
 * who is never a row here. An invite becomes membership only through its
 * emailed link (/team/accept) or, for an account whose email is verified
 * (Google, Apple), automatically on its next visit (claimInvitesByVerifiedEmail).
 * Invite ids are prefixed "invite:" in the roster so one memberId field
 * addresses both kinds of row.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function GET() {
  const gate = await requireOrg('manage_team')
  if (!gate.ok) return gate.response
  try {
    return NextResponse.json({ members: await roster(gate.value.orgId) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load team' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireOrg('manage_team')
  if (!gate.ok) return gate.response
  const { orgId, user } = gate.value
  try {
    const body = await request.json().catch(() => ({}))
    const email = String(body?.email || '').trim().toLowerCase()
    const name = String(body?.name || '').trim().slice(0, 120) || null
    const role = String(body?.role || 'staff')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (!isTeamRole(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    const ownerEmail = (await adminDb.collection('users').doc(orgId).get()).data()?.email
    if (email === String(user.email || '').toLowerCase() || email === String(ownerEmail || '').toLowerCase()) {
      return NextResponse.json({ error: 'That account already runs this organization' }, { status: 400 })
    }

    // An invite is an email Tikèm sends to a typed address: rate-limit it.
    const HOUR = 60 * 60 * 1000
    const checks = await Promise.all([
      consumeRateLimit({ key: `org-invite:uid:${user.id}`, limit: 30, windowMs: HOUR }),
      consumeRateLimit({ key: `org-invite:ip:${clientIp(request)}`, limit: 60, windowMs: HOUR }),
      consumeRateLimit({ key: `org-invite:to:${email}`, limit: 5, windowMs: 24 * HOUR }),
    ])
    if (checks.some((c) => c.limited)) {
      return NextResponse.json({ error: 'Too many invites. Please try again later.' }, { status: 429 })
    }

    // Already a member: just set the role.
    const existing = await teamCol(orgId).where('email', '==', email).limit(5).get()
    const activeRow = existing.docs.find((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data()?.status === 'active' && d.data()?.uid === d.id)
    if (activeRow) {
      await activateMember({ orgId, uid: activeRow.id, email, name: name || activeRow.data()?.name, role, addedBy: user.id })
      const row: RosterRow = { id: activeRow.id, uid: activeRow.id, email, name, role, status: 'active', joined_at: iso(activeRow.data()?.joined_at) }
      return NextResponse.json({ success: true, member: row })
    }

    // Replace any earlier open invite to the same address.
    const prior = await adminDb.collection(ORG_INVITES).where('org_id', '==', orgId).where('email', '==', email).get()
    const batch = adminDb.batch()
    for (const d of prior.docs) {
      if (!d.data()?.accepted_at) batch.set(d.ref, { revoked_at: FieldValue.serverTimestamp() }, { merge: true })
    }
    const token = randomToken(32)
    const ref = adminDb.collection(ORG_INVITES).doc()
    batch.set(ref, {
      org_id: orgId,
      email,
      name,
      role,
      token_hash: sha256Hex(token),
      invited_by: user.id,
      created_at: FieldValue.serverTimestamp(),
      expires_at: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
      accepted_at: null,
      revoked_at: null,
    })
    await batch.commit()

    // www host: the apex 308s and loses nothing here, but keep links canonical.
    const acceptUrl = `https://www.tikem.co/team/accept?invite=${encodeURIComponent(ref.id)}&token=${encodeURIComponent(token)}`
    after(async () => {
      try {
        const [orgName, lang] = await Promise.all([orgDisplayName(orgId), resolveEmailLang({ email })])
        const invitedBy = user.full_name || orgName
        const { subject, html } = teamInviteEmail({ lang, orgName, invitedBy, role, acceptUrl })
        await sendEmail({ to: email, subject, html })
      } catch (err) {
        console.error('team invite email failed', err)
      }
    })

    const row: RosterRow = { id: `${INVITE_PREFIX}${ref.id}`, uid: null, email, name, role, status: 'invited', joined_at: new Date().toISOString() }
    return NextResponse.json({ success: true, member: row })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to invite' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireOrg('manage_team')
  if (!gate.ok) return gate.response
  const { orgId, user } = gate.value
  try {
    const body = await request.json().catch(() => ({}))
    const memberId = String(body?.memberId || '')
    const role = String(body?.role || '')
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    if (!isTeamRole(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    if (memberId.startsWith(INVITE_PREFIX)) {
      const ref = adminDb.collection(ORG_INVITES).doc(memberId.slice(INVITE_PREFIX.length))
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.org_id !== orgId) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      await ref.set({ role }, { merge: true })
      return NextResponse.json({ success: true })
    }

    const snap = await teamCol(orgId).doc(memberId).get()
    if (!snap.exists) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const d = snap.data() || {}
    if (d.status === 'active' && d.uid === memberId) {
      await activateMember({ orgId, uid: memberId, email: String(d.email || ''), name: d.name, role, addedBy: user.id })
    } else {
      await snap.ref.set({ role, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update role' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireOrg('manage_team')
  if (!gate.ok) return gate.response
  const { orgId } = gate.value
  try {
    const memberId = new URL(request.url).searchParams.get('memberId') || ''
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    if (memberId.startsWith(INVITE_PREFIX)) {
      const ref = adminDb.collection(ORG_INVITES).doc(memberId.slice(INVITE_PREFIX.length))
      const snap = await ref.get()
      if (snap.exists && snap.data()?.org_id === orgId) {
        await ref.set({ revoked_at: FieldValue.serverTimestamp() }, { merge: true })
      }
      return NextResponse.json({ success: true })
    }
    await deactivateMember(orgId, memberId)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to remove member' }, { status: 500 })
  }
}
