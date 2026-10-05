import { cookies, headers } from 'next/headers'
import { adminAuth } from './admin'

export async function getServerSession() {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value

    // Mobile app support: allow Firebase ID token auth.
    // The mobile client can send `Authorization: Bearer <firebase_id_token>`.
    // An explicit token outranks any cookie: a stale or other-account cookie
    // riding along must never decide who the caller is.
    const headerStore = await headers()
    const hasTokenHeader = Boolean(
      headerStore.get('authorization')?.startsWith('Bearer ') || headerStore.get('x-firebase-token')
    )
    if (!sessionCookie || hasTokenHeader) {
      const authHeader = headerStore.get('authorization') || headerStore.get('Authorization')
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null

      const tokenFromAltHeader =
        headerStore.get('x-firebase-token') ||
        headerStore.get('X-Firebase-Token') ||
        headerStore.get('x-firebase-token'.toLowerCase())

      const token = bearer || (tokenFromAltHeader ? String(tokenFromAltHeader).trim() : null)

      if (!token) {
        return { user: null, error: 'No session cookie' }
      }

      const decodedClaims = await adminAuth.verifyIdToken(token, true)
      const user = await adminAuth.getUser(decodedClaims.uid)

      return {
        user: {
          id: user.uid,
          email: user.email || '',
          user_metadata: {
            full_name: user.displayName || '',
            phone: user.phoneNumber || '',
          },
        },
        error: null,
      }
    }

    // Verify the session cookie
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const user = await adminAuth.getUser(decodedClaims.uid)

    return {
      user: {
        id: user.uid,
        email: user.email || '',
        user_metadata: {
          full_name: user.displayName || '',
          phone: user.phoneNumber || '',
        },
      },
      error: null,
    }
  } catch (error) {
    // Most "failures" here are expected, everyday conditions: an expired or
    // revoked session cookie, a stale token, or Next.js signalling dynamic
    // rendering during build. Logging these as errors floods the runtime logs.
    // Only surface genuinely unexpected failures.
    const code = (error as { code?: string })?.code || ''
    const digest = (error as { digest?: string })?.digest || ''
    const isExpectedAuthState =
      code === 'auth/session-cookie-expired' ||
      code === 'auth/session-cookie-revoked' ||
      code === 'auth/invalid-session-cookie' ||
      code === 'auth/id-token-expired' ||
      code === 'auth/id-token-revoked' ||
      code === 'auth/invalid-id-token' ||
      code === 'auth/user-not-found' ||
      code === 'auth/argument-error'
    const isDynamicRenderSignal = digest === 'DYNAMIC_SERVER_USAGE'

    if (!isExpectedAuthState && !isDynamicRenderSignal) {
      console.error('Session verification error:', error)
    }

    return { user: null, error: 'Invalid session' }
  }
}
