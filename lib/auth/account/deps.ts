/**
 * Production wiring for the account routes (lib/auth/account/handlers.ts).
 */

import 'server-only'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { consumeRateLimit, clientIpKey } from '@/lib/rate-limit'
import { isPhoneAuthEnabled } from '@/lib/auth/otp/flag'
import { firestoreOtpStore } from '@/lib/auth/otp/store'
import { limitsFromEnv } from '@/lib/auth/otp/service'
import { notifyPhoneLinked } from '@/lib/auth/otp/notify'
import { ResendEmailCodeSender } from './email-sender'
import { openMergeSession, type AccountDeps } from './handlers'

export function productionAccountDeps(): AccountDeps {
  return {
    enabled: () => isPhoneAuthEnabled(),
    db: () => adminDb,
    auth: () => adminAuth as any,
    store: () => firestoreOtpStore(adminDb),
    emailSender: () => new ResendEmailCodeSender(),
    // ID token only, revocation checked; auth_time drives the merge freshness rule.
    caller: async (idToken) => {
      const decoded: any = await adminAuth.verifyIdToken(idToken, true)
      return decoded?.uid ? { uid: decoded.uid, authTime: Number(decoded.auth_time || 0) } : null
    },
    rateLimit: (key, limit, windowMs) => consumeRateLimit({ key, limit, windowMs }),
    ipKey: (req) => clientIpKey(req),
    onMerged: async (targetUid, phone) => {
      if (phone) await notifyPhoneLinked(targetUid, phone)
    },
    limits: () => limitsFromEnv(),
  }
}

/** The phone link route's hook: a verified number that is on another account. */
export function phoneInUseMergeHook() {
  return (callerUid: string, ownerUid: string) =>
    openMergeSession(
      { db: () => adminDb, auth: () => adminAuth as any },
      {
        callerUid,
        // The account signed in keeps everything; the number's account folds into it.
        sourceUid: ownerUid,
        targetUid: callerUid,
        reason: 'account_added_phone',
        proofs: { source: 'phone_code', target: 'fresh_signin' },
      }
    )
}
