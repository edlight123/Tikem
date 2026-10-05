/**
 * Production wiring for the phone-auth handlers: firebase-admin, Firestore,
 * the env-selected sender and the env-tuned limits.
 */

import 'server-only'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isPhoneAuthEnabled } from './flag'
import { selectOtpSender } from './senders'
import { limitsFromEnv } from './service'
import { firestoreOtpStore } from './store'
import { adminProfileWriter } from './users'
import { allowedCountries } from './phone'
import { notifyPhoneLinked } from './notify'
import type { PhoneAuthDeps } from './handlers'

export function productionPhoneAuthDeps(): PhoneAuthDeps {
  return {
    enabled: () => isPhoneAuthEnabled(),
    store: () => firestoreOtpStore(adminDb),
    sender: () => selectOtpSender(),
    auth: () => adminAuth,
    profiles: () => adminProfileWriter(adminDb),
    // ID token only (checkRevoked). Deliberately NOT getServerSession(): that
    // falls back to the session cookie, which a cross-site request carries.
    bearerUid: async (idToken) => {
      const decoded = await adminAuth.verifyIdToken(idToken, true)
      return decoded?.uid ?? null
    },
    onPhoneLinked: (uid, e164) => notifyPhoneLinked(uid, e164),
    limits: () => limitsFromEnv(),
    allowedCountries: () => allowedCountries(),
  }
}
