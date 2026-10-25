'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * `smsEnabled` comes from the server (lib/sms.ts isSmsConfigured): a phone
 * lookup is only answered by text when a provider is configured. Otherwise
 * the link goes to the email address on the order, and the copy says so.
 */
export default function FindTicketsForm({ smsEnabled = false }: { smsEnabled?: boolean }) {
  const { t } = useTranslation('common')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [sentBy, setSentBy] = useState<'email' | 'phone'>('email')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = contact.trim()
    if (!value) return

    setStatus('sending')
    // One field, two meanings: anything with an "@" is an email, anything else is
    // treated as a phone number. The server normalizes both.
    const byEmail = value.includes('@')
    const payload = byEmail ? { email: value } : { phone: value }
    setSentBy(byEmail ? 'email' : 'phone')

    try {
      await fetch('/api/tickets/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      // The confirmation below is deliberately unconditional — it must not become an
      // oracle for "does this email have tickets?", and a network blip is not a reason
      // to leak that either way.
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div className="rounded-2xl bg-emerald-500/10 px-5 py-6 text-center">
        <p className="text-emerald-200 font-semibold">{t('find_tickets.success_title', 'Check your messages')}</p>
        <p className="text-sm text-white/70 mt-2 leading-relaxed">
          {sentBy === 'email'
            ? t('find_tickets.success_desc_email', 'If we have tickets for that email address, the link is on its way to it now.')
            : smsEnabled
              ? t('find_tickets.success_desc', 'If we have tickets for that email or phone number, the link is on its way to it now.')
              : t(
                  'find_tickets.success_desc_phone_email',
                  "If we have tickets for that phone number, we've emailed the link to the email address used on that order."
                )}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="contact" className="block text-xs uppercase tracking-wider text-white/50 mb-1.5">
          {t('find_tickets.label', 'Email or phone')}
        </label>
        <input
          id="contact"
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          disabled={status === 'sending'}
          placeholder={t('find_tickets.placeholder', 'you@example.com')}
          className="w-full rounded-lg bg-white/[0.055] px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-400/60 disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={status === 'sending' || !contact.trim()}
        className="block w-full bg-white hover:bg-white/90 text-black font-semibold py-3 px-5 rounded transition-colors disabled:opacity-50 min-h-[44px]"
      >
        {status === 'sending' ? t('find_tickets.sending', 'Sending…') : t('find_tickets.submit', 'Send my ticket link')}
      </button>
    </form>
  )
}
