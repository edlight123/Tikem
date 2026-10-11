/**
 * Re-checks before an admin APPROVES or COMPLETES a withdrawal.
 *
 * A request is filed when everything was in order, but it can sit in the queue
 * for days. In between, the organizer can be banned, their identity
 * verification revoked, their payout profile put on hold by a destination
 * change, their bank proof rejected, or the destination swapped. The admin
 * endpoint used to re-check only the MonCash number. This is the full list,
 * shared by the action route (which refuses) and the queue listing (which shows
 * the same reasons next to the row before anyone clicks).
 *
 * Every lookup fails CLOSED (an unreadable fact is a blocker), because this
 * guards money leaving.
 */
import { adminDb } from '@/lib/firebase/admin'
import { getOrganizerIdentityVerificationStatus, reviewWithdrawalDestination } from '@/lib/firestore/payout'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getDecryptedBankDestination } from '@/lib/firestore/payout-destinations'
import { payoutFreezeStatus } from '@/lib/moderation/ban'
import { payoutProfileInactiveReason } from '@/lib/payouts/profile-readiness'
import { holderMatchesKyc, loadKycLegalNames } from '@/lib/payouts/payee-identity'

export type ApprovalBlockerCode =
  | 'payouts_frozen'
  | 'identity_not_verified'
  | 'payout_profile_inactive'
  | 'event_payouts_frozen'
  | 'destination_mismatch'
  | 'bank_destination_missing'
  | 'bank_proof_rejected'
  | 'bank_holder_mismatch'
  | 'bank_account_changed'
  | 'check_failed'

export type ApprovalBlocker = {
  code: ApprovalBlockerCode
  message: string
  /** Only the MonCash destination mismatch keeps its explicit, logged override. */
  overridable?: boolean
}

function last4(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.slice(-4)
}

async function bankBlockers(row: Record<string, any>, organizerId: string): Promise<ApprovalBlocker[]> {
  const out: ApprovalBlocker[] = []
  const destinationId = row?.bankDestinationId ? String(row.bankDestinationId) : null
  let holder: unknown = row?.bankDetails?.accountHolder

  if (destinationId) {
    const details = await getDecryptedBankDestination({ organizerId, destinationId })
    if (!details) {
      out.push({ code: 'bank_destination_missing', message: 'The saved bank account this request pays was removed.' })
      return out
    }
    holder = details.accountHolder
    const rowLast4 = last4(row?.bankDetails?.accountNumber)
    if (rowLast4 && last4(details.accountNumber) !== rowLast4) {
      out.push({
        code: 'bank_account_changed',
        message: 'The saved bank account changed since this request was filed (different account number).',
      })
    }
    const proofIds = destinationId === 'bank_primary' ? ['bank_bank_primary', 'bank'] : [`bank_${destinationId}`]
    const snaps = await Promise.all(
      proofIds.map((id) =>
        adminDb.collection('organizers').doc(organizerId).collection('verificationDocuments').doc(id).get()
      )
    )
    const proof = snaps.find((snap: any) => snap?.exists)
    if (proof && String((proof.data() as any)?.status || '') === 'failed') {
      out.push({ code: 'bank_proof_rejected', message: 'The bank proof for this account was rejected.' })
    }
  }

  const kyc = await loadKycLegalNames(organizerId)
  if (kyc.verified && (kyc.legalName || kyc.organizationName) && !holderMatchesKyc(holder, kyc)) {
    out.push({
      code: 'bank_holder_mismatch',
      message: 'The bank account holder does not exactly match the organizer’s verified legal name.',
    })
  }
  return out
}

/**
 * Everything that must still be true to pay this row. Empty = clear to act.
 */
export async function withdrawalApprovalBlockers(row: Record<string, any>): Promise<ApprovalBlocker[]> {
  const blockers: ApprovalBlocker[] = []
  try {
    const isPromoter = row?.payee_type === 'promoter'
    const uid = String((isPromoter ? row?.promoter_uid || row?.organizerId : row?.organizerId) || '')
    if (!uid) return [{ code: 'check_failed', message: 'This request has no payee.' }]

    const freeze = await payoutFreezeStatus(uid)
    if (freeze.frozen) {
      blockers.push({
        code: 'payouts_frozen',
        message: freeze.cause === 'banned' ? 'The payee is banned: payouts are frozen.' : 'Payouts are frozen for this payee.',
      })
    }

    if (String(row?.method || '') === 'moncash') {
      if ((await reviewWithdrawalDestination(row)) === 'mismatch') {
        blockers.push({
          code: 'destination_mismatch',
          message: "This MonCash number is not the payee's saved payout number.",
          overridable: true,
        })
      }
    }

    // Promoter rows: no organizer KYC/profile of their own on this rail.
    if (isPromoter) return blockers

    const [identity, profile] = await Promise.all([
      getOrganizerIdentityVerificationStatus(uid),
      getPayoutProfile(uid, 'haiti'),
    ])
    if (identity !== 'verified') {
      blockers.push({
        code: 'identity_not_verified',
        message:
          identity === 'failed'
            ? 'The organizer’s identity verification was rejected or revoked.'
            : 'The organizer’s identity verification is not approved.',
      })
    }
    const inactive = payoutProfileInactiveReason(profile, String(row?.method) === 'bank' ? 'bank' : 'MonCash')
    if (inactive) {
      blockers.push({
        code: 'payout_profile_inactive',
        message:
          inactive.code === 'payout_on_hold'
            ? `The payout profile is on hold${inactive.availableAt ? ` until ${inactive.availableAt}` : ''}.`
            : `The payout profile is not active (${inactive.code}).`,
      })
    }

    if (row?.eventId) {
      const eventSnap = await adminDb.collection('events').doc(String(row.eventId)).get()
      const event = eventSnap?.exists ? (eventSnap.data() as any) : null
      if (event && (event.payouts_frozen === true || String(event.status || '') === 'cancelled')) {
        blockers.push({
          code: 'event_payouts_frozen',
          message: 'The event was cancelled or its payouts frozen: its money is reserved for buyer refunds.',
        })
      }
    }

    if (String(row?.method || '') === 'bank') blockers.push(...(await bankBlockers(row, uid)))
  } catch (err: any) {
    console.error('[approval-checks] re-check failed', { message: err?.message })
    blockers.push({ code: 'check_failed', message: 'The payee could not be re-checked. Try again.' })
  }
  return blockers
}
