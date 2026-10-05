'use server'

import { adminAuth } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import { updatePayoutConfig as updatePayoutConfigLib, updatePayoutProfileConfig as updatePayoutProfileConfigLib } from '@/lib/firestore/payout'
import type { PayoutConfig, PayoutProfileId } from '@/lib/firestore/payout'
import { setDeclaredMarkets } from '@/lib/firestore/organizer-markets'

// The Stripe account is set only by the Connect onboarding route; a browser
// payload must never be able to point an organizer's sales at another account.
function withoutStripeAccount(updates: Partial<PayoutConfig>): Partial<PayoutConfig> {
  const { stripeAccountId: _ignored, ...rest } = (updates || {}) as any
  return rest
}

export async function updatePayoutConfig(
  updates: Partial<PayoutConfig>
): Promise<{ success: boolean; error?: string; requiresVerification?: boolean }> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const result = await updatePayoutConfigLib(decodedClaims.uid, withoutStripeAccount(updates))
    if (!result?.success) {
      const message = String(result?.error || 'Failed to update payout configuration')
      if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
        return { success: false, requiresVerification: true }
      }
      return { success: false, error: message }
    }
    return { success: true }
  } catch (error) {
    const message = String((error as any)?.message || 'Failed to update payout configuration')
    if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
      return { success: false, requiresVerification: true }
    }
    console.error('Error updating payout config:', error)
    return { success: false, error: message }
  }
}

export async function updatePayoutProfileConfig(
  profileId: PayoutProfileId,
  updates: Partial<PayoutConfig>
): Promise<{ success: boolean; error?: string; requiresVerification?: boolean }> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const result = await updatePayoutProfileConfigLib(decodedClaims.uid, profileId, withoutStripeAccount(updates))
    if (!result?.success) {
      const message = String(result?.error || 'Failed to update payout configuration')
      if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
        return { success: false, requiresVerification: true }
      }
      return { success: false, error: message }
    }
    return { success: true }
  } catch (error) {
    const message = String((error as any)?.message || 'Failed to update payout configuration')
    if (message.includes('PAYOUT_CHANGE_VERIFICATION_REQUIRED')) {
      return { success: false, requiresVerification: true }
    }
    console.error('Error updating payout profile config:', error)
    return { success: false, error: message }
  }
}

/**
 * Declare (or re-declare) the countries this organizer runs events in.
 *
 * A PREFERENCE, not a permission: it decides which payout rails the settings UI
 * leads with. The rail an event actually needs is still resolved from the
 * EVENT's country server-side. Saving an empty list clears the declaration and
 * restores the "show every rail" default — nobody gets locked out of a market
 * by an answer they gave months ago.
 */
export async function updateDeclaredMarkets(
  markets: string[]
): Promise<{ success: boolean; error?: string; markets?: string[] }> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const saved = await setDeclaredMarkets(decodedClaims.uid, markets)
    return { success: true, markets: saved }
  } catch (error) {
    console.error('Error updating declared markets:', error)
    return { success: false, error: String((error as any)?.message || 'Failed to save markets') }
  }
}
