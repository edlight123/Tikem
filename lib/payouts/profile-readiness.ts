/**
 * Why a payout profile cannot pay out right now, in words the organizer can act
 * on. The withdraw routes used to answer "Please complete payout verification"
 * for every inactive state, which told someone on a 24h destination-change hold
 * to re-upload their ID.
 *
 * Pure: reads only the profile getPayoutProfile returned (its status and
 * verificationStatus are server-derived there).
 */
import type { PayoutConfig } from '@/lib/firestore/payout'

export type ProfileInactiveCode =
  | 'payout_not_set_up'
  | 'identity_pending'
  | 'identity_rejected'
  | 'payout_on_hold'
  | 'payout_verification_pending'

export type ProfileInactive = {
  error: string
  code: ProfileInactiveCode
  message: string
  /** ISO, for payout_on_hold. */
  availableAt?: string | null
}

function holdUntilIso(raw: unknown): string | null {
  if (!raw) return null
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Null when the profile is active; otherwise the real reason. */
export function payoutProfileInactiveReason(
  profile: Pick<PayoutConfig, 'status' | 'verificationStatus' | 'payoutHoldUntil'> | null | undefined,
  rail: 'MonCash' | 'bank' = 'MonCash'
): ProfileInactive | null {
  if (profile && profile.status === 'active') return null

  if (!profile || profile.status === 'not_setup') {
    return {
      error: 'Payout method not set up',
      code: 'payout_not_set_up',
      message: `Add your payout details in Payout settings before requesting ${rail} withdrawals.`,
    }
  }

  if (profile.status === 'on_hold') {
    const availableAt = holdUntilIso(profile.payoutHoldUntil)
    return {
      error: 'Payouts on hold',
      code: 'payout_on_hold',
      message: availableAt
        ? `Your payout details were changed recently. For your security, withdrawals reopen at ${availableAt}.`
        : 'Your payouts are on hold. Please contact Tikèm support.',
      availableAt,
    }
  }

  const identity = profile.verificationStatus?.identity
  if (identity === 'failed') {
    return {
      error: 'Identity verification not approved',
      code: 'identity_rejected',
      message: 'Your identity verification was not approved. Review the feedback on the Verification page and resubmit.',
    }
  }
  if (identity !== 'verified') {
    return {
      error: 'Identity verification pending',
      code: 'identity_pending',
      message:
        'Your identity verification is not approved yet. Complete it (or wait for our review) before requesting withdrawals.',
    }
  }

  return {
    error: 'Payout verification pending',
    code: 'payout_verification_pending',
    message: `Your ${rail} payout details are still being verified.`,
  }
}
