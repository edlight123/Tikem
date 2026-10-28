'use client'

import { useTranslation } from 'react-i18next'
import { suggestEmailFix } from '@/lib/email/suggest'

/**
 * "Did you mean you@gmail.com? Use it" under an email field, shown while the
 * typed domain looks misspelled. One tap swaps in the fix.
 */
export default function EmailSuggestion({ email, onAccept }: { email: string; onAccept: (fixed: string) => void }) {
  const { t } = useTranslation('common')
  const fixed = suggestEmailFix(email)
  if (!fixed) return null
  return (
    <p className="mt-1.5 text-[13px] text-white/60" role="status">
      {t('email_check.did_you_mean', { email: fixed })}{' '}
      <button type="button" onClick={() => onAccept(fixed)} className="font-medium text-brand-400 underline-offset-2 hover:underline">
        {t('email_check.use_it')}
      </button>
    </p>
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
