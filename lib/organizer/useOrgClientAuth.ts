'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

/**
 * Client auth readiness for /organizer pages that query Firestore from the
 * browser. Unlike useOrganizerClientGuard it does NOT require users/{uid}.role
 * to be 'organizer': the server layout (app/organizer/layout.tsx) already
 * decided this account may use the portal, which now includes org team
 * members (admin/manager) who are not organizers themselves. Signed out still
 * goes to sign-in, coming back to this page.
 */
export function useOrgClientAuth(loginRedirectPath?: string) {
  const router = useRouter()
  const pathname = usePathname()
  const back = loginRedirectPath ?? pathname ?? '/organizer'
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    // authStateReady first: the first onAuthStateChanged emission can be a
    // null from before the persisted session is restored.
    auth
      .authStateReady()
      .catch(() => {})
      .then(() => {
        if (cancelled) return
        unsubscribe = onAuthStateChanged(auth, (u) => {
          if (cancelled) return
          if (!u) {
            router.replace(`/auth/login?redirect=${encodeURIComponent(back)}`)
            return
          }
          setFirebaseUser(u)
          setLoading(false)
        })
      })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [router, back])

  return { firebaseUser, loading }
}
