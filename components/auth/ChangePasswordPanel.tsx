'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Loader2 } from 'lucide-react'
import { auth } from '@/lib/firebase/client'
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
  type User,
} from 'firebase/auth'

/**
 * Change the signed-in user's Tikèm password, entirely client-side:
 * reauthenticate with the current password, then updatePassword. Firebase
 * holds the password, so there is no server route for this.
 *
 * Accounts with no password provider (Google / Apple sign-in only) get a plain
 * sentence instead of a form that could never succeed.
 *
 * Used by the organizer security page and the attendee /settings page.
 */

const MIN_LENGTH = 8

const FIELD =
  'w-full rounded bg-white/[0.06] py-3 pl-10 pr-4 text-[16px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50'

type Notice = { kind: 'success' | 'error'; text: string } | null

/** Human name for the non-password providers on an account. */
export function socialProviderName(user: Pick<User, 'providerData'> | null): string | null {
  const ids = (user?.providerData || []).map((p) => p?.providerId)
  if (ids.includes('password')) return null
  const names: string[] = []
  if (ids.includes('google.com')) names.push('Google')
  if (ids.includes('apple.com')) names.push('Apple')
  return names.length ? names.join(' / ') : null
}

export function ChangePasswordPanel({ className = '' }: { className?: string }) {
  const { t } = useTranslation('auth')
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [ready, setReady] = useState(Boolean(auth.currentUser))
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setReady(true)
    })
    return unsub
  }, [])

  const provider = socialProviderName(user)
  const hasPassword = Boolean(user?.providerData?.some((p) => p?.providerId === 'password'))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    if (next.length < MIN_LENGTH) {
      setNotice({ kind: 'error', text: t('change_password.too_short') })
      return
    }
    if (next !== confirm) {
      setNotice({ kind: 'error', text: t('change_password.mismatch') })
      return
    }
    const u = auth.currentUser
    if (!u || !u.email) {
      setNotice({ kind: 'error', text: t('change_password.signed_out') })
      return
    }
    setBusy(true)
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current))
      await updatePassword(u, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setNotice({ kind: 'success', text: t('change_password.success') })
    } catch (err: any) {
      const code = String(err?.code || '')
      const text =
        code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials'
          ? t('change_password.wrong_current')
          : code === 'auth/too-many-requests'
            ? t('change_password.too_many')
            : code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements'
              ? t('change_password.weak')
              : code === 'auth/requires-recent-login' || code === 'auth/user-token-expired'
                ? t('change_password.signed_out')
                : t('change_password.failed')
      setNotice({ kind: 'error', text })
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    const email = auth.currentUser?.email
    if (!email) return
    setNotice(null)
    try {
      await sendPasswordResetEmail(auth, email)
      setNotice({ kind: 'success', text: t('change_password.reset_sent', { email }) })
    } catch {
      setNotice({ kind: 'error', text: t('login.reset_failed') })
    }
  }

  if (!ready) {
    return (
      <div className={className}>
        <Loader2 className="h-5 w-5 animate-spin text-white/40" />
      </div>
    )
  }

  if (!user) {
    return <p className={`text-sm text-white/60 ${className}`}>{t('change_password.signed_out')}</p>
  }

  if (!hasPassword) {
    return (
      <p className={`text-sm text-white/70 ${className}`}>
        {t('change_password.provider_only', { provider: provider || 'Google / Apple' })}
      </p>
    )
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    autoComplete: string
  ) => (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-white/70">
        {label}
      </label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
        <input
          type="password"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
      </div>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className={`max-w-md space-y-4 ${className}`}>
      {field('current_password', t('change_password.current'), current, setCurrent, t('change_password.current_placeholder'), 'current-password')}
      {field('new_password', t('change_password.new'), next, setNext, t('change_password.new_placeholder'), 'new-password')}
      {field('confirm_password', t('change_password.confirm'), confirm, setConfirm, t('change_password.confirm_placeholder'), 'new-password')}

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded px-4 py-2.5 text-sm ${
            notice.kind === 'success' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'
          }`}
        >
          {notice.text}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-2 rounded bg-white px-6 py-2.5 font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? t('change_password.submitting') : t('change_password.submit')}
      </button>
      <p className="text-xs text-white/50">{t('change_password.min_length')}</p>
      <button
        type="button"
        onClick={handleReset}
        className="text-left text-[13px] text-white/60 underline-offset-4 hover:text-white hover:underline"
      >
        {t('change_password.forgot')}
      </button>
    </form>
  )
}
