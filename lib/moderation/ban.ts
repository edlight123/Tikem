/**
 * Banning an organizer: the account can no longer post, AND their published
 * events come down. The admin confirm dialog has always promised "their events
 * will be hidden", but the ban only flipped `status`/`can_create_events`, so a
 * banned organizer's events stayed live. Each event taken down here is tagged
 * `unpublished_by_ban: true` so an unban can be reviewed event by event (an
 * unban deliberately does NOT republish anything automatically).
 */
import { adminDb } from '@/lib/firebase/admin'

export async function unpublishOrganizerEvents(
  organizerId: string,
  reason = 'Organizer banned for violating the Terms of Service',
  now = new Date()
): Promise<number> {
  const snap = await adminDb
    .collection('events')
    .where('organizer_id', '==', organizerId)
    .where('is_published', '==', true)
    .get()
  if (snap.empty) return 0

  // Batches cap at 500 writes.
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += 450) {
    const batch = adminDb.batch()
    for (const d of docs.slice(i, i + 450)) {
      batch.update(d.ref, {
        is_published: false,
        rejected: true,
        rejection_reason: reason,
        unpublished_by_ban: true,
        updated_at: now,
      })
    }
    await batch.commit()
  }
  return docs.length
}

// ── Payout freeze ───────────────────────────────────────────────────────────
//
// Owner decision (2026-10): a banned organizer's payouts are ALL frozen —
// including money already earned and released — until an admin decides. The
// freeze is an explicit flag on organizers/{id}, separate from users.status, so
// an unban (an account decision) never silently reopens the money: an admin
// lifts it with the organizer-actions `unfreeze_payouts` action.
//
//   organizers/{id}.payoutsFrozen === true   ← THE flag every payout path reads
//   organizers/{id}.payoutRelease.highRisk   ← also set, so the shared release
//                                              ladder routes anything that slips
//                                              past a reader to admin review
//
// Every Haiti withdraw path (withdraw-moncash incl. instant, withdraw-bank,
// promoter withdrawals) and the admin approve/complete refuse while
// payoutFreezeStatus() says frozen. The Stripe release cron should skip an
// organizer whose `payoutsFrozen` is true (or whose users.status is 'banned').

export const PAYOUTS_FROZEN_FIELD = 'payoutsFrozen' as const

export type PayoutFreezeReason = 'organizer_banned' | 'admin_freeze'

export type PayoutFreezeStatus =
  | { frozen: false }
  | {
      frozen: true
      /** 'banned' = users.status; 'payouts_frozen' = the organizers flag. */
      cause: 'banned' | 'payouts_frozen'
      code: 'payouts_frozen'
      message: string
    }

export const PAYOUTS_FROZEN_MESSAGE =
  'Payouts on this account are on hold while Tikèm reviews it. Please contact Tikèm support.'

/** Pure: judge the two docs. Exported for tests. */
export function payoutFreezeFromDocs(userData: any, organizerData: any): PayoutFreezeStatus {
  if (String(userData?.status || '').toLowerCase() === 'banned') {
    return { frozen: true, cause: 'banned', code: 'payouts_frozen', message: PAYOUTS_FROZEN_MESSAGE }
  }
  if (organizerData?.[PAYOUTS_FROZEN_FIELD] === true) {
    return { frozen: true, cause: 'payouts_frozen', code: 'payouts_frozen', message: PAYOUTS_FROZEN_MESSAGE }
  }
  return { frozen: false }
}

/**
 * Is this payee's money frozen? Reads users/{uid} and organizers/{uid}. FAILS
 * CLOSED: a read error is reported as frozen, because this guards money leaving.
 */
export async function payoutFreezeStatus(uid: string): Promise<PayoutFreezeStatus> {
  try {
    const [userSnap, organizerSnap] = await Promise.all([
      adminDb.collection('users').doc(String(uid)).get(),
      adminDb.collection('organizers').doc(String(uid)).get(),
    ])
    return payoutFreezeFromDocs(
      userSnap?.exists ? userSnap.data() : null,
      organizerSnap?.exists ? organizerSnap.data() : null
    )
  } catch (err: any) {
    console.error('[ban] payout freeze lookup failed; treating as frozen', { uid, message: err?.message })
    return { frozen: true, cause: 'payouts_frozen', code: 'payouts_frozen', message: PAYOUTS_FROZEN_MESSAGE }
  }
}

/** Freeze every payout for this organizer (ban, or an explicit admin freeze). */
export async function freezeOrganizerPayouts(
  organizerId: string,
  opts: { adminId: string; reason: PayoutFreezeReason; now?: Date }
): Promise<void> {
  const ref = adminDb.collection('organizers').doc(String(organizerId))
  const now = (opts.now || new Date()).toISOString()
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? (snap.data() as any) || {} : {}
    const priorHighRisk =
      data?.[PAYOUTS_FROZEN_FIELD] === true
        ? data?.payoutsFrozenPriorHighRisk === true
        : data?.payoutRelease?.highRisk === true
    tx.set(
      ref,
      {
        [PAYOUTS_FROZEN_FIELD]: true,
        payoutsFrozenAt: now,
        payoutsFrozenBy: opts.adminId,
        payoutsFrozenReason: opts.reason,
        // Remembered so an unfreeze restores the admin's own highRisk setting
        // instead of clearing one that predates the ban.
        payoutsFrozenPriorHighRisk: priorHighRisk,
        payoutRelease: { highRisk: true },
      },
      { merge: true }
    )
  })
}

/** Lift the freeze. Only an explicit admin action calls this — never unban. */
export async function unfreezeOrganizerPayouts(
  organizerId: string,
  opts: { adminId: string; now?: Date }
): Promise<void> {
  const ref = adminDb.collection('organizers').doc(String(organizerId))
  const now = (opts.now || new Date()).toISOString()
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? (snap.data() as any) || {} : {}
    if (data?.[PAYOUTS_FROZEN_FIELD] !== true) return
    tx.set(
      ref,
      {
        [PAYOUTS_FROZEN_FIELD]: false,
        payoutsUnfrozenAt: now,
        payoutsUnfrozenBy: opts.adminId,
        payoutRelease: { highRisk: data?.payoutsFrozenPriorHighRisk === true },
      },
      { merge: true }
    )
  })
}
