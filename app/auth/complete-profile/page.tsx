'use client'

/**
 * Web twin of the app's CompleteProfileScreen: after a phone sign-in that
 * created an account (or one with no name / email), the person enters their
 * first and last name and an email, then the email code, with "Verify later".
 * An email that belongs to another Tikèm account is combined into it after
 * the code (lib/auth/account); an organizer on the phone side goes to support.
 *
 * Reached from PhoneLoginPanel when /api/auth/phone/verify answers
 * needsProfile. Premium quiet: one small title per step, filled fields, one
 * 40px white button, quiet text links.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onAuthStateChanged, signInWithCustomToken, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/client'
import { safeSameOriginPath } from '@/lib/safeUrl'
import { profileCompletion, normalizeEmail } from '@/lib/auth/account/completion'
import { TikemWordmark } from '@/components/ui/TikemLogo'

type Step = 'details' | 'code' | 'merge' | 'reauth' | 'support'

const KNOWN = new Set([
  'invalid_name', 'invalid_email', 'email_already_set', 'email_taken', 'cooldown', 'rate_limited', 'send_failed',
  'invalid_code', 'too_many_attempts', 'account_disabled', 'merge_expired', 'merge_in_progress',
  'target_has_other_phone', 'network',
])

async function refreshSession(user: User) {
  const idToken = await user.getIdToken(true)
  await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).catch(() => {})
}

export default function CompleteProfilePage() {
  const { t, i18n } = useTranslation('auth')
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [needsName, setNeedsName] = useState(true)
  const [askEmail, setAskEmail] = useState(true)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<Step>('details')
  const [taken, setTaken] = useState(false)
  const [code, setCode] = useState('')
  const [mergeId, setMergeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [redirectTo, setRedirectTo] = useState('/')
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRedirectTo(safeSameOriginPath(new URLSearchParams(window.location.search).get('redirect'), window.location.origin))
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        window.location.href = '/auth/login?redirect=/auth/complete-profile'
        return
      }
      setUser(u)
      const snap = await getDoc(doc(db, 'users', u.uid)).catch(() => null)
      const d: any = snap?.exists() ? snap.data() : {}
      const c = profileCompletion({ fullName: d.full_name, authEmail: u.email, pendingEmail: d.pending_email })
      setNeedsName(c.needsName)
      setAskEmail(!u.email)
      setFirst(d.first_name || '')
      setLast(d.last_name || '')
      setEmail(d.pending_email || '')
      setReady(true)
    })
  }, [])

  const describe = (c?: string) => t(`account.errors.${c && KNOWN.has(c) ? c : 'generic'}`)

  async function call(path: string, body: Record<string, unknown>) {
    const current = auth.currentUser
    if (!current) throw { code: 'unauthorized' }
    let res: Response
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await current.getIdToken()}` },
        body: JSON.stringify(body),
      })
    } catch {
      throw { code: 'network' }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw { code: data?.code, status: res.status }
    return data
  }

  const done = async () => {
    const current = auth.currentUser
    if (current) {
      await current.reload().catch(() => {})
      await refreshSession(current)
    }
    window.location.href = redirectTo
  }

  async function sendCode(target: string) {
    setBusy(true)
    setError(null)
    try {
      const sent = await call('/api/account/email/start', { email: target, locale: (i18n.language || 'en').slice(0, 2) })
      setEmail(target)
      setTaken(Boolean(sent?.taken))
      setCode('')
      setStep('code')
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (err: any) {
      if (err?.code === 'cooldown') {
        setEmail(target)
        setStep('code')
      } else setError(describe(err?.code))
    } finally {
      setBusy(false)
    }
  }

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    if (needsName && (!first.trim() || !last.trim())) return setError(t('account.complete.nameRequired'))
    const normalized = normalizeEmail(email)
    if (askEmail && !normalized) return setError(t('account.complete.emailRequired'))
    setBusy(true)
    setError(null)
    try {
      if (needsName) await call('/api/account/profile/complete', { firstName: first, lastName: last })
    } catch (err: any) {
      setBusy(false)
      return setError(describe(err?.code))
    }
    setBusy(false)
    if (askEmail && normalized) return sendCode(normalized)
    await done()
  }

  async function verify(value: string) {
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await call('/api/account/email/verify', { email, code: value })
      if (res.status === 'attached') return await done()
      if (res.status === 'merge_available') {
        setMergeId(res.mergeId)
        setStep('merge')
      } else if (res.status === 'needs_review') setStep('support')
      else setError(describe(res.code))
    } catch (err: any) {
      setError(describe(err?.code))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function later() {
    setBusy(true)
    setError(null)
    try {
      await call('/api/account/email/later', { email })
      await done()
    } catch (err: any) {
      setError(describe(err?.code))
      setBusy(false)
    }
  }

  async function combine() {
    if (!mergeId) return
    setBusy(true)
    setError(null)
    try {
      const res = await call('/api/account/merge', { mergeId })
      if (res.token) {
        const cred = await signInWithCustomToken(auth, res.token)
        await refreshSession(cred.user)
        window.location.href = redirectTo
        return
      }
      await done()
    } catch (err: any) {
      if (err?.code === 'reauth_required') setStep('reauth')
      else if (err?.code === 'organizer_merge_needs_review') setStep('support')
      else setError(describe(err?.code))
      setBusy(false)
    }
  }

  function otherEmail() {
    setStep('details')
    setEmail('')
    setTaken(false)
    setMergeId(null)
    setError(null)
  }

  if (!ready || !user) {
    return <div className="min-h-screen bg-canvas" aria-busy />
  }

  const field =
    'block w-full h-12 px-4 text-base rounded bg-surface text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand-400/50'
  const primary = 'w-full h-10 px-4 rounded bg-inverse text-on-inverse text-sm font-semibold disabled:opacity-50'
  const quiet = 'text-sm text-fg-muted hover:text-fg'

  return (
    <div className="min-h-screen bg-canvas px-4 py-12 sm:py-20">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <div className="mb-8 flex justify-center">
          <TikemWordmark className="text-headline text-fg" />
        </div>
        {step === 'details' && (
          <form className="space-y-3" onSubmit={submitDetails}>
            <h1 className="text-xl font-semibold text-fg mb-2">{t('account.complete.title')}</h1>
            {needsName && (
              <div className="grid grid-cols-2 gap-3">
                <input aria-label={t('account.complete.firstName')} placeholder={t('account.complete.firstName')} autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} className={field} />
                <input aria-label={t('account.complete.lastName')} placeholder={t('account.complete.lastName')} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} className={field} />
              </div>
            )}
            {askEmail && (
              <input type="email" aria-label={t('account.complete.email')} placeholder={t('account.complete.email')} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            )}
            {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>
              {t('account.complete.continue')}
            </button>
          </form>
        )}

        {step === 'code' && (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold text-fg">{t('account.email.title')}</h1>
            <p className="text-sm text-fg-muted">{t('account.email.sentTo', { email })}</p>
            {taken && <p className="text-sm text-fg-muted">{t('account.email.taken')}</p>}
            <input
              ref={codeRef}
              aria-label={t('account.email.codeAccessibility')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(v)
                if (v.length === 6) verify(v)
              }}
              className={`${field} text-center tracking-[0.5em] text-2xl font-semibold`}
            />
            {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
            {busy && <p className="text-sm text-fg-subtle">{t('account.email.verifying')}</p>}
            <div className="flex items-center justify-between">
              <button type="button" className={quiet} onClick={otherEmail} disabled={busy}>
                {t('account.email.change')}
              </button>
              <button type="button" className="text-sm font-semibold text-fg" onClick={() => sendCode(email)} disabled={busy}>
                {t('account.email.resend')}
              </button>
            </div>
            {!taken && (
              <div className="pt-2 text-center">
                <button type="button" className={quiet} onClick={later} disabled={busy}>
                  {t('account.email.later')}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'merge' && (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold text-fg">{t('account.merge.title')}</h1>
            <p className="text-sm text-fg-muted">{t('account.merge.body', { email })}</p>
            {error && <p role="alert" className="text-sm text-danger-soft">{error}</p>}
            <button type="button" className={primary} onClick={combine} disabled={busy}>
              {t('account.merge.cta')}
            </button>
            <div className="text-center">
              <button type="button" className={quiet} onClick={otherEmail} disabled={busy}>
                {t('account.merge.useOtherEmail')}
              </button>
            </div>
          </div>
        )}

        {step === 'reauth' && (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold text-fg">{t('account.merge.confirmTitle')}</h1>
            <a href={`/auth/login?redirect=${encodeURIComponent('/auth/complete-profile')}`} className={`${primary} inline-flex items-center justify-center`}>
              {t('account.merge.confirmCta')}
            </a>
          </div>
        )}

        {step === 'support' && (
          <div className="space-y-3">
            <h1 className="text-xl font-semibold text-fg">{t('account.support.title')}</h1>
            <a href={`mailto:support@tikem.co?subject=${encodeURIComponent(t('account.support.subject'))}`} className={`${primary} inline-flex items-center justify-center`}>
              {t('account.support.cta')}
            </a>
            <div className="text-center">
              <button type="button" className={quiet} onClick={otherEmail}>
                {t('account.merge.useOtherEmail')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
