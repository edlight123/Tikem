'use client'

/**
 * Web phone sign-in (WhatsApp code). Rendered by the login page ONLY when the
 * build has NEXT_PUBLIC_PHONE_AUTH_ENABLED=true, and even then it renders
 * nothing until /api/auth/phone/status answers 200 (server env + remote
 * switch both on). Any failure keeps it hidden.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { safeSameOriginPath } from '@/lib/safeUrl'

const COUNTRIES = [
  { iso: 'HT', dial: '509', flag: '🇭🇹' },
  { iso: 'US', dial: '1', flag: '🇺🇸' },
  { iso: 'CA', dial: '1', flag: '🇨🇦' },
  { iso: 'FR', dial: '33', flag: '🇫🇷' },
  { iso: 'DO', dial: '1', flag: '🇩🇴' },
] as const

const KNOWN = new Set([
  'invalid_phone', 'unsupported_country', 'cooldown', 'rate_limited', 'send_failed', 'unavailable',
  'invalid_code', 'too_many_attempts', 'account_disabled', 'network',
])

function compose(dial: string, iso: string, input: string): string {
  const v = input.trim()
  if (v.startsWith('+')) return `+${v.replace(/\D/g, '')}`
  if (v.startsWith('00')) return `+${v.slice(2).replace(/\D/g, '')}`
  let digits = v.replace(/\D/g, '')
  if (iso === 'FR' && digits.startsWith('0')) digits = digits.slice(1)
  return `+${dial}${digits}`
}

export function PhoneLoginPanel({ redirectTo }: { redirectTo: string }) {
  const { t, i18n } = useTranslation('auth')
  const [available, setAvailable] = useState(false)
  const [iso, setIso] = useState<string>('HT')
  const [input, setInput] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/phone/status', { cache: 'no-store' })
      .then(async (r) => (r.status === 200 ? (await r.json())?.enabled === true : false))
      .catch(() => false)
      .then((on) => alive && setAvailable(on))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (step !== 'code' || now >= resendAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step, resendAt, now])

  if (!available) return null

  const country = COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0]
  const locale = (i18n.language || 'en').slice(0, 2)

  const describe = (c?: string, retryAfterSec?: number) =>
    c === 'cooldown' && retryAfterSec
      ? t('phone.errors.cooldown', { seconds: retryAfterSec })
      : t(`phone.errors.${c && KNOWN.has(c) ? c : 'generic'}`)

  async function post(path: string, body: Record<string, unknown>) {
    let res: Response
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw { code: 'network' }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw { code: res.status === 404 ? 'unavailable' : data?.code, retryAfterSec: data?.retryAfterSec }
    return data
  }

  async function send(target: string) {
    setBusy(true)
    setError(null)
    try {
      const sent = await post('/api/auth/phone/start', { phone: target, country: iso, locale })
      setPhone(target)
      setCode('')
      setResendAt(Date.now() + (sent?.resendAfterSec ?? 60) * 1000)
      setNow(Date.now())
      setStep('code')
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (err: any) {
      setError(describe(err?.code, err?.retryAfterSec))
    } finally {
      setBusy(false)
    }
  }

  async function verify(value: string) {
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      const { token } = await post('/api/auth/phone/verify', { phone, country: iso, code: value, locale })
      const cred = await signInWithCustomToken(auth, token)
      const idToken = await cred.user.getIdToken()
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      window.location.href = safeSameOriginPath(redirectTo, window.location.origin)
    } catch (err: any) {
      setError(describe(err?.code))
      setCode('')
      setBusy(false)
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const field =
    'block w-full px-4 py-3 text-base rounded-lg bg-white/[0.06] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50'

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-300">{error}</p>}
      {step === 'phone' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            send(compose(country.dial, iso, input))
          }}
        >
          <div className="flex gap-2">
            <select
              aria-label={t('phone.countryPickerTitle')}
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              className="rounded-lg bg-white/[0.10] text-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-400/50"
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {c.flag} {t(`phone.countries.${c.iso}`)} +{c.dial}
                </option>
              ))}
            </select>
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('phone.phonePlaceholder')}
              className={field}
            />
          </div>
          <p className="text-[13px] text-white/55">{t('phone.hint')}</p>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 px-4 rounded-full bg-white text-black text-base font-semibold disabled:opacity-50"
          >
            {t('phone.continueWithWhatsApp')}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{t('phone.codeTitle')}</h3>
            <p className="text-sm text-white/60">{t('phone.codeSentTo', { phone })}</p>
          </div>
          <input
            ref={codeRef}
            aria-label={t('phone.codeAccessibility')}
            type="text"
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
          {busy && <p className="text-sm text-white/55">{t('phone.verifying')}</p>}
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-white/60 hover:text-white" onClick={() => setStep('phone')} disabled={busy}>
              {t('phone.changeNumber')}
            </button>
            {secondsLeft > 0 ? (
              <span className="text-white/45">{t('phone.resendIn', { seconds: secondsLeft })}</span>
            ) : (
              <button type="button" className="font-semibold text-white" onClick={() => send(phone)} disabled={busy}>
                {t('phone.resend')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PhoneLoginPanel
