'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { suggestEmailFix } from '@/lib/email/suggest'

/**
 * Holds a form until the person answers "Did you mean you@gmail.com?".
 *
 * Some typo domains (gnail.com, hotmial.com) are real and take mail, so the
 * server check lets them through and the ticket goes to a stranger. While the
 * typed domain looks misspelled, the form asks once: use the fix, or keep
 * what was typed. Either answer clears it.
 */
export function useEmailSuggestion(email: string, setEmail: (next: string) => void) {
  const [kept, setKept] = useState<string | null>(null)
  const [attention, setAttention] = useState(false)
  const typed = email.trim().toLowerCase()
  const fixed = suggestEmailFix(email)
  const pending = !!fixed && kept !== typed
  return {
    /** Call at submit: true means stop, the card now asks for an answer. */
    holdSubmit() {
      if (pending) setAttention(true)
      return pending
    },
    props: {
      fixed: pending ? fixed : null,
      attention,
      onAccept() {
        if (fixed) setEmail(fixed)
        setAttention(false)
      },
      onKeep() {
        setKept(typed)
        setAttention(false)
      },
    },
  }
}

export default function EmailSuggestion({
  fixed,
  attention,
  onAccept,
  onKeep,
}: ReturnType<typeof useEmailSuggestion>['props']) {
  const { t } = useTranslation('common')
  if (!fixed) return null
  const at = fixed.lastIndexOf('@')
  // divs, not <p>: the site's phone typography flattens every <p> to 14px.
  return (
    <div
      role="group"
      aria-live="polite"
      className={`mt-2 rounded bg-white/[0.06] px-4 py-3.5 transition-shadow ${
        attention ? 'ring-1 ring-brand-400/70' : ''
      }`}
    >
      <div className="text-[12px] font-medium uppercase tracking-wider text-white/45">
        {t('email_check.did_you_mean')}
      </div>
      <div className="mt-1 break-all text-[16px] font-semibold text-white">
        {fixed.slice(0, at + 1)}
        <span className="text-brand-400">{fixed.slice(at + 1)}</span>
      </div>
      {attention && <div className="mt-1.5 text-[13px] text-white/60">{t('email_check.confirm_first')}</div>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="h-9 rounded bg-white px-4 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          {t('email_check.use_this')}
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="h-9 rounded bg-white/[0.07] px-4 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.12]"
        >
          {t('email_check.keep_mine')}
        </button>
      </div>
    </div>
  )
}

/**
 * Ask the server whether the address's domain can receive mail at all.
 * Resolves true on any doubt (network error, timeout), so it never blocks a
 * real person; false only when the domain definitely has no mail server.
 */
export async function emailDomainTakesMail(email: string): Promise<boolean> {
  try {
    const res = await fetch('/api/email/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(5000),
    })
    const json = await res.json()
    return json?.reason !== 'no_mail_server'
  } catch {
    return true
  }
}
