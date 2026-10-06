import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const session = cookieStore.get('session')

    if (!session) {
      return NextResponse.json({ user: null }, { status: 200 })
    }

    // Verify the session cookie
    const decodedClaims = await adminAuth.verifySessionCookie(session.value, true)
    
    return NextResponse.json({ 
      user: {
        uid: decodedClaims.uid,
        email: decodedClaims.email,
      }
    })
  } catch (error) {
    // Expired / revoked / malformed session cookies are an expected, everyday
    // condition (e.g. a returning visitor with a stale cookie). Treat these as
    // "logged out" silently instead of logging them as errors, which floods the
    // runtime logs. Only surface genuinely unexpected failures.
    const code = (error as { code?: string })?.code || ''
    const digest = (error as { digest?: string })?.digest || ''
    const isExpectedAuthState =
      code === 'auth/session-cookie-expired' ||
      code === 'auth/session-cookie-revoked' ||
      code === 'auth/invalid-session-cookie' ||
      code === 'auth/argument-error'
    const isDynamicRenderSignal = digest === 'DYNAMIC_SERVER_USAGE'

    if (!isExpectedAuthState && !isDynamicRenderSignal) {
      console.error('Session verification error:', error)
    }

    return NextResponse.json({ user: null }, { status: 200 })
  }
}

/** Max age of the Firebase sign-in behind an ID token we will mint a cookie from. */
const MAX_AUTH_AGE_SECONDS = 5 * 60

const ALLOWED_ORIGINS = new Set(['https://tikem.co', 'https://www.tikem.co'])

/**
 * A browser POST must come from our own pages. The request's own origin
 * (preview deploys, localhost) counts as ours. React Native's fetch sends no
 * Origin header at all, so a MISSING Origin is allowed; a FOREIGN one is not.
 */
function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (origin === request.nextUrl.origin) return true
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')
    if (origin === `${proto}://${host}`) return true
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      if (new URL(appUrl).origin === origin) return true
    } catch {
      // ignore a malformed env value
    }
  }
  return false
}

export async function POST(request: NextRequest) {
  try {
    // JSON only: a form POST from another site cannot set this content type
    // without a CORS preflight, so this closes login-CSRF via plain forms.
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 })
    }
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const idToken = body && typeof body.idToken === 'string' ? body.idToken : ''

    if (!idToken) {
      return NextResponse.json({ error: 'Missing ID token' }, { status: 400 })
    }

    // checkRevoked=true: a token from a disabled/revoked account is refused.
    let decoded
    try {
      decoded = await adminAuth.verifyIdToken(idToken, true)
    } catch {
      return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 })
    }

    // Only mint a 5-day cookie from a RECENT sign-in (Firebase's recommended
    // check). Otherwise a leaked 1-hour ID token could be upgraded into a
    // 5-day session.
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (!decoded.auth_time || nowSeconds - decoded.auth_time > MAX_AUTH_AGE_SECONDS) {
      return NextResponse.json({ error: 'Recent sign-in required' }, { status: 401 })
    }

    const expiresIn = 60 * 60 * 24 * 5 * 1000 // 5 days

    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn })

    // Set the session cookie
    const cookieStore = await cookies()
    cookieStore.set('session', sessionCookie, {
      // cookies().set takes SECONDS; createSessionCookie took milliseconds.
      maxAge: expiresIn / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    // Invite-link attribution (lib/invites): a visitor who arrived through
    // /i/{code} carries a cookie, and a NEW account is credited to that invite
    // once, ever. Best-effort: a failure here never fails the sign-in.
    const inviteCookie = cookieStore.get('tikem_invite')?.value
    if (inviteCookie) {
      try {
        const { claimFromInviteCookie } = await import('@/lib/invites/claimCookie')
        if (await claimFromInviteCookie(decoded.uid, inviteCookie)) cookieStore.delete('tikem_invite')
      } catch (err) {
        console.error('[invites] claim at sign-in failed', (err as any)?.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Session creation error:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

/**
 * Sign-out clears THIS browser's cookie only. It deliberately does not call
 * revokeRefreshTokens: that would sign the user out of every device (the
 * mobile app included) whenever they log out of one browser tab. A stolen
 * cookie therefore stays valid until it expires (5 days); an admin/account
 * "sign out everywhere" action is the place for revocation.
 */
export async function DELETE() {
  try {
    // Clear the session cookie
    const cookieStore = await cookies()
    cookieStore.delete('session')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Session deletion error:', error)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
