/**
 * THE identity (KYC) definition. Server-only.
 *
 * Payouts (lib/firestore/payout.ts, payout-profiles.ts), the paid-publish gate
 * (lib/events/publish-gate.ts) and anything else that asks "has this person
 * proved who they are?" must ask here, so there is exactly one answer.
 *
 * An organizer is identity-verified when, and only when:
 *  - their verification_requests record is `approved` — the record an admin
 *    approves through /api/admin/review-verification, which only accepts a
 *    request that was submitted with stored ID + selfie paths; AND
 *  - neither users/{uid} nor organizers/{uid} carries an explicit
 *    `is_verified: false`. Approval sets both flags true; an admin removing
 *    verification sets them false, so a stale `approved` record left behind
 *    by any older path can never keep payouts active after an un-verify.
 *
 * The flags alone NEVER verify anyone. Older admin overrides
 * (/api/admin/verify-organizer before it was locked) and the deleted
 * /api/organizer/submit-identity-verification stub could set flags or an
 * `organizers/{uid}/verificationDocuments/identity` doc without any reviewed
 * documents; neither is consulted here.
 */
import { adminDb } from '@/lib/firebase/admin'

export type IdentityStatus = 'verified' | 'pending' | 'changes_requested' | 'rejected' | 'none'

const PENDING_STATUSES = new Set(['pending', 'pending_review', 'in_review'])

export interface IdentityInputs {
  request: Record<string, any> | null
  user: Record<string, any> | null
  organizer: Record<string, any> | null
}

/** Pure decision, so it can be tested without Firestore. */
export function decideIdentityStatus({ request, user, organizer }: IdentityInputs): IdentityStatus {
  const status = String(request?.status || '').trim().toLowerCase()
  if (status === 'approved') {
    const revoked = user?.is_verified === false || organizer?.is_verified === false
    return revoked ? 'none' : 'verified'
  }
  if (PENDING_STATUSES.has(status)) return 'pending'
  if (status === 'changes_requested') return 'changes_requested'
  if (status === 'rejected') return 'rejected'
  return 'none'
}

/**
 * The organizer's verification request: doc id == uid, else (older/migrated
 * data) the first doc whose userId / user_id names them.
 */
export async function loadVerificationRequest(uid: string): Promise<Record<string, any> | null> {
  const byId = await adminDb.collection('verification_requests').doc(uid).get()
  if (byId.exists) return (byId.data() as Record<string, any>) || {}
  let byUserId: any
  let byUser_id: any
  try {
    ;[byUserId, byUser_id] = await Promise.all([
      adminDb.collection('verification_requests').where('userId', '==', uid).limit(1).get(),
      adminDb.collection('verification_requests').where('user_id', '==', uid).limit(1).get(),
    ])
  } catch (e: any) {
    // Fail closed: no readable request means no verified identity.
    console.warn('[kyc/identity] legacy request lookup failed', { message: e?.message })
    return null
  }
  const hit = (!byUserId.empty && byUserId.docs[0]) || (!byUser_id.empty && byUser_id.docs[0]) || null
  return hit ? ((hit.data() as Record<string, any>) || {}) : null
}

/**
 * Internal accounts verified by Tikèm itself, with no ID documents (the App Store /
 * Play review demo organizer). `kyc_exemptions/{uid}` is server-only: Firestore
 * rules deny every client read and write, so only the Admin SDK can add one.
 * An exemption needs `active: true` and a `reason`; remove the doc to revoke it.
 */
export async function hasKycExemption(uid: string): Promise<boolean> {
  if (!uid) return false
  try {
    const snap = await adminDb.collection('kyc_exemptions').doc(uid).get()
    const d = snap.exists ? (snap.data() as Record<string, any>) : null
    return Boolean(d && d.active === true && typeof d.reason === 'string' && d.reason.trim())
  } catch {
    return false
  }
}

export async function getIdentityStatus(uid: string): Promise<IdentityStatus> {
  if (!uid) return 'none'
  const [request, userSnap, organizerSnap, exempt] = await Promise.all([
    loadVerificationRequest(uid),
    adminDb.collection('users').doc(uid).get(),
    adminDb.collection('organizers').doc(uid).get(),
    hasKycExemption(uid),
  ])
  if (exempt) return 'verified'
  return decideIdentityStatus({
    request,
    user: userSnap.exists ? (userSnap.data() as Record<string, any>) : null,
    organizer: organizerSnap.exists ? (organizerSnap.data() as Record<string, any>) : null,
  })
}

export async function isIdentityVerified(uid: string): Promise<boolean> {
  return (await getIdentityStatus(uid)) === 'verified'
}

/**
 * Is `path` a KYC upload owned by `uid`? Exactly `verification/{uid}/{file}`,
 * no URLs, no dot or empty segments, no backslashes. Used wherever a stored
 * document reference is trusted (submission, restart cleanup).
 */
export function isOwnedVerificationPath(path: unknown, uid: string): path is string {
  if (typeof path !== 'string' || !uid) return false
  if (path.length > 512) return false
  if (path.includes('\\') || /^[a-z]+:\/\//i.test(path)) return false
  const segments = path.split('/')
  if (segments.length !== 3) return false
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
  return segments[0] === 'verification' && segments[1] === uid
}
