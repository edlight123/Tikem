/**
 * Who a payout destination belongs to, judged against the KYC record.
 *
 * The names an organizer can edit (users.full_name, organizers.organizationName,
 * the payout profile's accountName) are claims. The only name Tikèm has checked
 * is the one frozen into the APPROVED verification request
 * (verification_requests/{uid}.steps.organizerInfo.fields), which an admin read
 * against the government ID. Destination checks compare against that, with
 * EXACT normalized-token matching: case, accents, punctuation and word order
 * are ignored, nothing else is. No substring match (that let "Jean" match
 * "Jean-Baptiste Enterprises"), no dropped or extra words.
 *
 * NOTE for the KYC owner: if lib/kyc/identity.ts later exposes the verified
 * legal name, loadKycLegalNames can delegate to it; the contract here is only
 * "names from an APPROVED request, else verified: false".
 */
import { adminDb, adminAuth } from '@/lib/firebase/admin'
import { mobileMoneyFingerprint } from '@/lib/firestore/payout'

export type KycLegalNames = {
  /** True only when the verification request is approved. */
  verified: boolean
  legalName: string | null
  organizationName: string | null
}

const NOT_VERIFIED: KycLegalNames = { verified: false, legalName: null, organizationName: null }

/** Lowercase, accent-free, punctuation-free words. */
export function nameTokens(raw: unknown): string[] {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Exact normalized-token match: the same multiset of words on both sides.
 * Word order is free ("Pierre Jean" = "Jean Pierre"); a missing, extra or
 * partial word is a mismatch. An empty side never matches.
 */
export function exactNameMatch(a: unknown, b: unknown): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0 || ta.length !== tb.length) return false
  return [...ta].sort().join(' ') === [...tb].sort().join(' ')
}

/** Does `holder` exactly match the KYC legal name or the KYC organization name? */
export function holderMatchesKyc(holder: unknown, kyc: KycLegalNames): boolean {
  if (!kyc.verified) return false
  return exactNameMatch(holder, kyc.legalName) || exactNameMatch(holder, kyc.organizationName)
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** Pure: names from one verification_requests doc. Exported for tests. */
export function kycNamesFromRequest(data: any): KycLegalNames {
  if (!data) return NOT_VERIFIED
  if (String(data.status || '').trim().toLowerCase() !== 'approved') return NOT_VERIFIED
  const fields = data?.steps?.organizerInfo?.fields || {}
  return {
    verified: true,
    legalName: pickString(fields.legal_name, fields.full_name, fields.fullName, fields.name),
    organizationName: pickString(fields.organization_name, fields.organizationName, fields.business_name),
  }
}

/**
 * The KYC-verified names, read server-side from the approved request. Never
 * throws: a failed read is "not verified", which every caller treats as a
 * refusal / manual review.
 */
export async function loadKycLegalNames(organizerId: string): Promise<KycLegalNames> {
  try {
    const direct = await adminDb.collection('verification_requests').doc(String(organizerId)).get()
    if (direct?.exists) return kycNamesFromRequest(direct.data())
    const [byUserId, byUser_id] = await Promise.all([
      adminDb.collection('verification_requests').where('userId', '==', String(organizerId)).limit(1).get(),
      adminDb.collection('verification_requests').where('user_id', '==', String(organizerId)).limit(1).get(),
    ])
    const hit = (!byUserId?.empty && byUserId.docs[0]) || (!byUser_id?.empty && byUser_id.docs[0]) || null
    return hit ? kycNamesFromRequest(hit.data()) : NOT_VERIFIED
  } catch (err: any) {
    console.error('[payee-identity] KYC name lookup failed', { organizerId, message: err?.message })
    return NOT_VERIFIED
  }
}

function toMs(value: any): number | null {
  if (!value) return null
  const raw = typeof value?.toDate === 'function' ? value.toDate() : value
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Pure: was the profile's CURRENT MonCash number confirmed by an SMS code?
 *
 * Accepted proofs, newest contract first:
 *  1. a server-written `mobileMoneyDetails.phoneVerifiedAt` / `otpVerifiedAt`
 *     (the KYC owner may add one) that is not older than the number itself;
 *  2. organizers/{id}/verificationDocuments/phone with status 'verified', for
 *     the same (masked) number the profile holds now, verified no earlier than
 *     the number was saved (phoneNumberFingerprintSetAt).
 * Anything else — no record, another number, a code older than the number —
 * is "not verified" and the caller falls back to manual review.
 */
export function moncashOtpVerifiedFrom(profile: any, phoneDoc: any): boolean {
  const mm = profile?.mobileMoneyDetails || {}
  const numberSetAt = toMs(mm.phoneNumberFingerprintSetAt)
  const notOlderThanNumber = (ms: number | null) => ms !== null && (numberSetAt === null || ms >= numberSetAt)

  const explicit = toMs(mm.phoneVerifiedAt) ?? toMs(mm.otpVerifiedAt)
  if (explicit !== null && notOlderThanNumber(explicit)) return true

  if (!phoneDoc || String(phoneDoc.status || '') !== 'verified') return false
  const docNumber = String(phoneDoc.phoneNumber || '')
  const profileNumber = String(mm.phoneNumber || '')
  if (!docNumber || !profileNumber || docNumber !== profileNumber) return false
  return notOlderThanNumber(toMs(phoneDoc.verifiedAt))
}

/**
 * Is the profile's MonCash number the organizer's own Firebase sign-in phone?
 * Phone sign-in already proves ownership with an SMS code sent by Firebase, and
 * Tikèm itself sends no SMS (no provider configured), so this is the practical
 * proof of ownership. Compared by fingerprint: the profile only stores a masked
 * number plus `phoneNumberFingerprint`.
 */
export async function moncashNumberIsSignInPhone(organizerId: string, profile: any): Promise<boolean> {
  try {
    let fingerprint: string | null = profile?.mobileMoneyDetails?.phoneNumberFingerprint || null
    if (!fingerprint) {
      const raw = await adminDb
        .collection('organizers')
        .doc(String(organizerId))
        .collection('payoutProfiles')
        .doc('haiti')
        .get()
      fingerprint = raw.exists ? ((raw.data() as any)?.mobileMoneyDetails?.phoneNumberFingerprint || null) : null
    }
    if (!fingerprint) return false
    const user = await adminAuth.getUser(String(organizerId))
    const signIn = mobileMoneyFingerprint(user.phoneNumber || '')
    return Boolean(signIn && signIn === fingerprint)
  } catch (err: any) {
    console.error('[payee-identity] sign-in phone comparison failed', { organizerId, message: err?.message })
    return false
  }
}

export async function moncashNumberOtpVerified(organizerId: string, profile: any): Promise<boolean> {
  // Proof of ownership, any of: the server-computed verdict on the profile
  // (getPayoutProfile -> mobileMoneyOtpVerified), the number being the
  // organizer's Firebase phone sign-in (moncashNumberIsSignInPhone), or a
  // verified phone record for the current number. Otherwise: manual review.
  if (profile?.mobileMoneyOtpVerified === true) return true
  if (await moncashNumberIsSignInPhone(organizerId, profile)) return true
  try {
    const snap = await adminDb
      .collection('organizers')
      .doc(String(organizerId))
      .collection('verificationDocuments')
      .doc('phone')
      .get()
    return moncashOtpVerifiedFrom(profile, snap?.exists ? snap.data() : null)
  } catch (err: any) {
    console.error('[payee-identity] phone verification lookup failed', { organizerId, message: err?.message })
    return false
  }
}
