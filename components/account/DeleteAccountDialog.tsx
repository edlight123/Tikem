'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'

const CONFIRM_WORD = 'DELETE'
const SUPPORT_EMAIL = 'support@tikem.co'
const RETURN_PATH = '/profile?delete=1'

/** Mirrors `Obligation` in lib/account/deletion.ts. */
type Obligation =
  | { type: 'upcoming_events_with_sales'; events: Array<{ id: string; title: string; ticketsSold: number }> }
  | { type: 'unwithdrawn_balance'; balances: Array<{ currency: string; amountMinor: number }> }
  | { type: 'withdrawals_in_flight'; count: number }
  | { type: 'promoter_wallet_balance'; balances: Array<{ currency: string; amountMinor: number }> }

type Step = 'confirm' | 'reauth' | 'blocked'
type Method = 'password' | 'google' | 'apple' | 'signin'

/**
 * BUNDLE: firebase/auth + the client app are imported inside the handlers,
 * never at module scope — see the note in components/profile/AccountCard.tsx.
 */
async function loadAuth() {
  const [authMod, { auth }] = await Promise.all([import('firebase/auth'), import('@/lib/firebase/client')])
  return { authMod, auth }
}

function methodFor(user: any): Method {
  const ids: string[] = (user?.providerData || []).map((p: any) => p?.providerId)
  if (!user) return 'signin'
  if (ids.includes('password')) return 'password'
  if (ids.includes('google.com')) return 'google'
  if (ids.includes('apple.com')) return 'apple'
  return 'signin'
}

function formatMinor(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

/**
 * The web account-deletion flow (same server contract as the mobile sheet):
 *   confirm → POST /api/account/delete
 *   401 reauth_required → re-verify (password / Google / Apple popup; or sign
 *     in again when the page only holds a session cookie) → retry
 *   409 organizer_has_active_obligations → list what to resolve
 *   200 → sign out everywhere and leave for the home page
 */
export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common')
  const [step, setStep] = useState<Step>('confirm')
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<Method>('signin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [obligations, setObligations] = useState<Obligation[]>([])

  useEffect(() => {
    if (!open) return
    setStep('confirm')
    setTyped('')
    setPassword('')
    setError(null)
    setObligations([])
  }, [open])

  if (!open) return null

  const k = (key: string, opts?: Record<string, unknown>) => t(`account_deletion.${key}`, opts as any) as string

  const attemptDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      const { authMod, auth } = await loadAuth()
      const user = auth.currentUser
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`
      const res = await fetch('/api/account/delete', { method: 'POST', headers, credentials: 'same-origin', body: '{}' })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data?.deleted) {
        await authMod.signOut(auth).catch(() => undefined)
        await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined)
        window.location.href = '/'
        return
      }
      if (data?.code === 'reauth_required' || (res.status === 401 && !user)) {
        setMethod(methodFor(user))
        setStep('reauth')
      } else if (data?.code === 'organizer_has_active_obligations') {
        setObligations(Array.isArray(data.obligations) ? data.obligations : [])
        setStep('blocked')
      } else {
        setError(k('failed'))
      }
    } catch {
      setError(k('failed'))
    }
    setBusy(false)
  }

  const handleReauth = async () => {
    if (method === 'signin') {
      window.location.href = `/auth/login?redirect=${encodeURIComponent(RETURN_PATH)}`
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { authMod, auth } = await loadAuth()
      const user = auth.currentUser
      if (!user) throw new Error('signed out')
      if (method === 'password') {
        await authMod.reauthenticateWithCredential(user, authMod.EmailAuthProvider.credential(user.email || '', password))
      } else if (method === 'google') {
        await authMod.reauthenticateWithPopup(user, new authMod.GoogleAuthProvider())
      } else {
        await authMod.reauthenticateWithPopup(user, new authMod.OAuthProvider('apple.com'))
      }
      await user.getIdToken(true)
    } catch (e: any) {
      setBusy(false)
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return
      setError(k('reauth_failed'))
      return
    }
    await attemptDelete()
  }

  const providerName = method === 'apple' ? 'Apple' : 'Google'
  const confirmDisabled =
    busy ||
    (step === 'confirm' && typed.trim().toUpperCase() !== CONFIRM_WORD) ||
    (step === 'reauth' && method === 'password' && !password)

  const title = step === 'reauth' ? k('reauth_title') : step === 'blocked' ? k('blocked_title') : k('dialog_title')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-[#141414] p-6">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-red-500/10 text-red-300">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>
        {/* h3 + `!`: .mobile-typography would drop this to text-base on a phone. */}
        <h3 id="delete-account-title" className="font-display !text-[24px] !leading-tight text-white">
          {title}
        </h3>

        {step === 'confirm' && (
          <div className="mt-3 space-y-4 !text-[14px] !leading-relaxed text-white/60">
            <p>{k('intro')}</p>
            <div>
              <p className="eyebrow mb-1 text-white/40">{k('deleted_heading')}</p>
              <p>{k('deleted_body')}</p>
            </div>
            <div>
              <p className="eyebrow mb-1 text-white/40">{k('kept_heading')}</p>
              <p>{k('kept_body')}</p>
            </div>
            <p className="text-white/85">{k('tickets_warning')}</p>
            <div>
              <label htmlFor="delete-account-confirm" className="eyebrow mb-2 block text-white/40">
                {k('type_to_confirm', { word: CONFIRM_WORD })}
              </label>
              <input
                id="delete-account-confirm"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={CONFIRM_WORD}
                className="w-full rounded-xl bg-white/[0.06] px-3.5 py-3 text-[16px] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500"
              />
            </div>
          </div>
        )}

        {step === 'reauth' && (
          <div className="mt-3 space-y-4 !text-[14px] !leading-relaxed text-white/60">
            <p>
              {method === 'password'
                ? k('reauth_body_password')
                : method === 'signin'
                  ? k('reauth_body_signin')
                  : k('reauth_body_provider', { provider: providerName })}
            </p>
            {method === 'password' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={k('password_placeholder')}
                aria-label={k('password_placeholder')}
                className="w-full rounded-xl bg-white/[0.06] px-3.5 py-3 text-[16px] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
              />
            )}
          </div>
        )}

        {step === 'blocked' && (
          <div className="mt-3 space-y-3 !text-[14px] !leading-relaxed text-white/60">
            <p>{k('blocked_body')}</p>
            <ul className="space-y-2">
              {obligations.map((o, i) => (
                <li key={i} className="rounded-xl bg-white/[0.055] px-4 py-3 text-white/85">
                  {o.type === 'upcoming_events_with_sales' && (
                    <>
                      <p>{k('obligation_events')}</p>
                      <ul className="mt-1 space-y-0.5 text-white/60">
                        {o.events.map((e) => (
                          <li key={e.id}>{k('obligation_event', { title: e.title, count: e.ticketsSold })}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {o.type === 'unwithdrawn_balance' &&
                    k('obligation_balance', {
                      amounts: o.balances.map((b) => formatMinor(b.amountMinor, b.currency)).join(', '),
                    })}
                  {o.type === 'withdrawals_in_flight' && k('obligation_withdrawals', { count: o.count })}
                  {o.type === 'promoter_wallet_balance' &&
                    k('obligation_promoter', {
                      amounts: o.balances.map((b) => formatMinor(b.amountMinor, b.currency)).join(', '),
                    })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-4 !text-[13px] text-red-300">{error}</p>}

        <p className="mt-5 !text-[12px] text-white/40">
          {k('support_prefix')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white/70 underline underline-offset-2 hover:text-white">
            {SUPPORT_EMAIL}
          </a>
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
          >
            {step === 'blocked' ? k('close') : k('cancel')}
          </button>
          {step !== 'blocked' && (
            <button
              type="button"
              onClick={step === 'confirm' ? attemptDelete : handleReauth}
              disabled={confirmDisabled}
              aria-busy={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-200 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy
                ? k('deleting')
                : step === 'confirm'
                  ? k('confirm')
                  : method === 'password'
                    ? k('continue')
                    : method === 'signin'
                      ? k('sign_in_again')
                      : k('continue_with', { provider: providerName })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
