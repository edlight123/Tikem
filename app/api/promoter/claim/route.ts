// "Add this to my account": attach a promoter record to a signed-in user, so the
// /promoter portal aggregates everything they promote. Same two-credential shape
// as the guest ticket claim: a session (the account it moves TO) plus the signed
// stats token (proof the caller is that promoter). Idempotent for the same
// account; refused if a different account already claimed it.

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getPromoterByStatsKey, verifyPromoterToken } from '@/lib/promoters'

/**
 * The organizer paying a commission must not be the promoter collecting it:
 * the commission is withheld from the organizer's net and paid out of Tikèm's
 * pool, so self-promotion converts held (refundable, release-laddered) sales
 * money into promoter cash. Refused for the event's organizer account and for
 * any account sharing that organizer's verified sign-in email or phone.
 */
async function sameIdentityAsOrganizer(claimerUid: string, organizerUid: string): Promise<boolean> {
  if (!organizerUid) return false
  if (claimerUid === organizerUid) return true
  const load = async (uid: string) => {
    try {
      return await adminAuth.getUser(uid)
    } catch (e: any) {
      if (String(e?.code || '') === 'auth/user-not-found') return null
      throw e
    }
  }
  const [claimer, organizer] = await Promise.all([load(claimerUid), load(organizerUid)])
  if (!claimer || !organizer) return false
  const email = (u: any) => (u?.emailVerified && u?.email ? String(u.email).trim().toLowerCase() : '')
  if (email(claimer) && email(claimer) === email(organizer)) return true
  const phone = (u: any) => String(u?.phoneNumber || '').replace(/\D/g, '')
  if (phone(claimer) && phone(claimer) === phone(organizer)) return true
  return false
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Sign in to add this to your account.' }, { status: 401 })
    }

    const { token } = await request.json().catch(() => ({ token: '' }))
    const statsKey = verifyPromoterToken(String(token || ''))
    const promoter = statsKey ? await getPromoterByStatsKey(statsKey) : null
    if (!promoter) {
      return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    }

    // The event's CURRENT organizer, not just the one stamped on the promoter row.
    const eventSnap = await adminDb.collection('events').doc(String(promoter.event_id)).get()
    const event = eventSnap.exists ? ((eventSnap.data() as any) ?? {}) : {}
    const organizerIds = Array.from(
      new Set([String(promoter.organizer_id || ''), String(event.organizer_id || event.organizerId || '')].filter(Boolean))
    )
    for (const organizerId of organizerIds) {
      if (await sameIdentityAsOrganizer(user.id, organizerId)) {
        return NextResponse.json(
          { error: "An event's organizer cannot be its promoter.", code: 'organizer_cannot_claim' },
          { status: 403 }
        )
      }
    }

    // Claimed in a transaction so two accounts racing for one link cannot both win.
    const ref = adminDb.collection('event_promoters').doc(promoter.id)
    const outcome = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return 'gone'
      const claimedBy = (snap.data() as any)?.claimed_by_uid
      if (claimedBy && claimedBy !== user.id) return 'taken'
      if (!claimedBy) {
        const nowIso = new Date().toISOString()
        tx.update(ref, { claimed_by_uid: user.id, claimed_at: nowIso, updated_at: nowIso })
      }
      return 'ok'
    })
    if (outcome === 'gone') {
      return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    }
    if (outcome === 'taken') {
      return NextResponse.json(
        { error: 'This promoter page is already in another Tikèm account.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[promoter-claim] failed', err)
    return NextResponse.json({ error: 'Could not add this to your account.' }, { status: 500 })
  }
}
