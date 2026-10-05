'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { auth, db } from '@/lib/firebase/client'
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { syncPublicProfileClient } from '@/lib/firestore/public-profile-client'
import Link from 'next/link'
import { BRAND } from '@/config/brand'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import { isDemoMode, isDemoEmail } from '@/lib/demo'
import { demoLogin } from '../actions'
import { PhoneLoginPanel } from '@/components/auth/PhoneLoginPanel'
import { safeSameOriginPath } from '@/lib/safeUrl'

// Phone (WhatsApp code) sign-in on the web. Build-time flag, default off; when
// on, the panel still hides itself unless the server reports the feature live.
const PHONE_AUTH_WEB = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === 'true'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useTranslation('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Same-origin paths only. The old startsWith('/') && !startsWith('//') check
  // let "/\evil.com" through, which browsers read as protocol-relative.
  function sanitizeRedirectTarget(target: string | null): string {
    return safeSameOriginPath(target, window.location.origin)
  }

  // Resolve the redirect target AFTER mount. Reading window.location/localStorage
  // during render makes the server (always '/') and client markup diverge, which
  // triggers a hydration mismatch on the signup link. Defaulting to '/' keeps the
  // initial client render identical to the server, then we update post-hydration.
  const [redirectTo, setRedirectTo] = useState('/')
  useEffect(() => {
    const fromQuery = sanitizeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'))
    if (fromQuery && fromQuery !== '/') {
      setRedirectTo(fromQuery)
      return
    }
    try {
      const sanitized = sanitizeRedirectTarget(window.localStorage.getItem('eh:pendingRedirect'))
      if (sanitized && sanitized !== '/') setRedirectTo(sanitized)
    } catch {
      // ignore
    }
  }, [])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Demo mode login
      if (isDemoMode() && isDemoEmail(email)) {
        const result = await demoLogin(email, password)
        
        if (result.error) {
          throw new Error(result.error)
        }

        // Force full page reload for demo mode
        window.location.href = redirectTo
        return
      }

      // Firebase authentication
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      
      // Create session cookie
      const idToken = await userCredential.user.getIdToken()
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })

      try {
        window.localStorage.removeItem('eh:pendingRedirect')
      } catch {
        // ignore
      }

      // Force router refresh and navigate
      window.location.href = redirectTo
    } catch (err: any) {
      setError(err.message || t('errors.login_failed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleLogin() {
    setError(null)
    setLoading(true)

    try {
      const provider = new GoogleAuthProvider()
      const userCredential = await signInWithPopup(auth, provider)
      const user = userCredential.user

      // Check if user document exists, if not create it
      const userDocRef = doc(db, 'users', user.uid)
      const userDoc = await getDoc(userDocRef)

      if (!userDoc.exists()) {
        // Create user document
        const newUserDoc = {
          email: user.email,
          full_name: user.displayName || '',
          role: 'attendee',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        await setDoc(userDocRef, newUserDoc)

        // H4: seed the cross-user-readable projection (best-effort; PII stripped).
        await syncPublicProfileClient(user.uid, newUserDoc)
      }

      // Create session cookie
      const idToken = await user.getIdToken()
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })

      try {
        window.localStorage.removeItem('eh:pendingRedirect')
      } catch {
        // ignore
      }

      // Redirect to specified page or home
      window.location.href = redirectTo
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError(t('errors.signin_cancelled'))
      } else {
        setError(err.message || t('errors.google_signin_failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0a0a0a] px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-20%] h-[460px] w-[460px] max-w-full -translate-x-1/2 rounded-full blur-[150px]" />
      <div className="relative max-w-md w-full space-y-7">
        <div className="text-center">
          <Link href="/" className="inline-flex justify-center">
            <TikemWordmark italic className="text-[46px] text-white" />
          </Link>
          <p className="mt-1.5 text-sm text-white/55">{BRAND.tagline}</p>
          <h2 className="mt-6 font-display text-2xl md:text-3xl text-white">
            {t('login.title')}
          </h2>
        </div>

        {PHONE_AUTH_WEB ? <PhoneLoginPanel redirectTo={redirectTo} /> : null}

        <form className="space-y-5" onSubmit={handleLogin}>
          {error && (
            <div className="border border-red-500/30 text-red-300 px-4 py-2.5 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[13px] font-medium text-white/70 mb-1.5">
                {t('login.email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full px-4 py-3 text-base rounded-lg bg-white/[0.06] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                placeholder={t('login.email_placeholder')}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[13px] font-medium text-white/70 mb-1.5">
                {t('login.password')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-4 py-3 pr-11 text-base rounded-lg bg-white/[0.06] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50"
                  placeholder={t('login.password_placeholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white p-1"
                  aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-3.5 px-4 rounded-lg text-white text-base font-semibold bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] focus:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t('login.submit_loading') : t('login.submit')}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-[13px]">
              <span className="px-2 bg-white/[0.03] text-white/45">{t('login.or_continue_with')}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-lg border border-white/15 text-white text-base font-semibold hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] focus:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {t('login.google')}
          </button>

          <div className="text-center">
            <p className="text-[13px] text-white/55">
              {t('login.no_account')}{' '}
              <Link
                href={`/auth/signup?redirect=${encodeURIComponent(redirectTo)}`}
                className="font-semibold text-brand-300 hover:text-brand-200"
              >
                {t('login.sign_up')}
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
