'use client'

// The account OFFER — never a demand. Same posture as the guest ticket page: the
// promoter's stats are already on screen above this; claiming just aggregates
// every event they promote into one portal.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

export default function PromoterAccountOffer({
  token,
  alreadyClaimed,
}: {
  token: string
  alreadyClaimed: boolean
}) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const returnTo = `/promoter/${encodeURIComponent(token)}`
  const signupHref = `/auth/signup?redirect=${encodeURIComponent(returnTo)}`
  const loginHref = `/auth/login?redirect=${encodeURIComponent(returnTo)}`

  async function handleAddToAccount() {
    setStatus('working')
    setMessage(null)
    try {
      const res = await fetch('/api/promoter/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        // Not signed in yet — that is the whole point of the offer.
        window.location.href = loginHref
        return
      }
      if (!res.ok) {
        setStatus('error')
        setMessage(data?.error || t('promoter.claim_error_generic', 'Could not add this to your account.'))
        return
      }

      setStatus('done')
      setMessage(t('promoter.claim_success', 'This promoter page is now in your account.'))
      try {
        // The navbar caches "has promoter records" per session — bust it so the
        // Promoter portal menu item appears right away.
        sessionStorage.removeItem('tikem_is_promoter')
      } catch {}
      router.refresh()
    } catch {
      setStatus('error')
      setMessage(t('promoter.claim_error_network', 'Could not reach Tikèm. Please try again.'))
    }
  }

  if (alreadyClaimed && status !== 'error') {
    return (
      <div className="mt-8 rounded-2xl bg-surface p-5">
        <p className="text-fg font-semibold">{t('promoter.claimed_title', 'This page is in your Tikèm account.')}</p>
        <a
          href="/promoter"
          className="inline-block mt-3 text-sm font-semibold text-fg underline underline-offset-4 decoration-fg-faint hover:decoration-fg"
        >
          {t('promoter.claimed_link', 'Open your promoter portal →')}
        </a>
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-2xl bg-surface p-5">
      <h2 className="font-display lowercase italic !text-section !leading-snug text-fg">{t('promoter.offer_title', 'Withdraw your commission')}</h2>
      <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">
        {t(
          'promoter.offer_desc',
          'Add this to a free Tikèm account to withdraw your earnings to MonCash and see every event you promote in one portal. This link keeps working either way.'
        )}
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <a
          href={signupHref}
          className="flex-1 text-center bg-surface-raised hover:bg-surface-high text-fg font-semibold py-3 px-5 rounded transition-colors min-h-[44px] flex items-center justify-center"
        >
          {t('promoter.create_account', 'Create an account')}
        </a>
        <button
          type="button"
          onClick={handleAddToAccount}
          disabled={status === 'working'}
          className="flex-1 bg-surface-raised text-fg-soft hover:bg-surface-high font-semibold py-3 px-5 rounded transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {status === 'working' ? t('promoter.adding', 'Adding…') : t('promoter.already_have_one', 'I already have one')}
        </button>
      </div>

      {message && (
        <p className={`mt-3 text-sm ${status === 'error' ? 'text-danger-soft' : 'text-success-soft'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
