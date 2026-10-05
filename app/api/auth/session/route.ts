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

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json()

    if (!idToken) {
      return NextResponse.json({ error: 'Missing ID token' }, { status: 400 })
    }

    // Verify the ID token and create a session cookie
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Session creation error:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

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
