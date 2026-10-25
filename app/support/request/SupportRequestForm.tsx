'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Send, Loader2, Ticket, CalendarDays, Info, Check } from 'lucide-react'
import Link from 'next/link'

/** Keys match SUPPORT_TOPICS in lib/email-templates/support.ts (the API validates them). */
const TOPICS = [
  'ticket_purchase',
  'payment',
  'refund',
  'event_access',
  'account',
  'event_creation',
  'payout',
  'check_in',
  'verification',
  'other',
] as const

/** A field on the form card: one step up the fill ladder, no outline. */
const FIELD =
  'w-full rounded bg-white/[0.06] px-4 py-3 text-[16px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/50'

type Status = { kind: 'idle' } | { kind: 'sent'; email: string; reference: string } | { kind: 'error'; message: string }

export default function SupportRequestForm() {
  const { t, i18n } = useTranslation('support')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    topic: '',
    subject: '',
    message: '',
    userType: 'attendee' as 'attendee' | 'organizer',
    // Honeypot: hidden from people; a bot that fills it is silently dropped.
    company: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setStatus({ kind: 'idle' })

    try {
      const res = await fetch('/api/support/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, lang: i18n.language }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: data?.code === 'rate_limited' ? t('request_form.rate_limited') : t('request_form.error_message'),
        })
        return
      }
      setStatus({ kind: 'sent', email: formData.email.trim(), reference: String(data?.reference || '') })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setStatus({ kind: 'error', message: t('request_form.error_message') })
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormData((f) => ({ ...f, topic: '', subject: '', message: '', company: '' }))
    setStatus({ kind: 'idle' })
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/support"
          className="inline-flex items-center gap-2 text-sm text-white/65 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('nav.back_to_support')}
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{t('request_form.title')}</h1>
          <p className="text-white/65">{t('request_form.description')}</p>
        </div>

        {status.kind === 'sent' ? (
          <div role="status" className="rounded bg-white/[0.055] p-6 sm:p-8">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-500/15">
              <Check className="h-6 w-6 text-brand-300" />
            </div>
            <h2 className="font-display lowercase !text-[28px] !leading-none text-white mb-3">
              {t('request_form.success_title')}
            </h2>
            <p className="text-white/70 mb-6">{t('request_form.success_message', { email: status.email, reference: status.reference })}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/support"
                className="inline-flex items-center justify-center rounded bg-white px-6 py-3 font-semibold text-black transition-colors hover:bg-white/90"
              >
                {t('request_form.back_to_support')}
              </Link>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center justify-center rounded bg-white/[0.08] px-6 py-3 font-semibold text-white transition-colors hover:bg-white/[0.14]"
              >
                {t('request_form.send_another')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded bg-white/[0.03] p-6 sm:p-8 space-y-6">
            {/* User type: a functional two-way toggle, so the selected tile is the white fill. */}
            <div>
              <span className="block text-sm font-semibold text-white/70 mb-3">{t('request_form.user_type_label')}</span>
              <div className="flex gap-3" role="radiogroup" aria-label={t('request_form.user_type_label')}>
                {(['attendee', 'organizer'] as const).map((type) => {
                  const selected = formData.userType === type
                  const Icon = type === 'attendee' ? Ticket : CalendarDays
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setFormData({ ...formData, userType: type })}
                      className={`flex-1 rounded px-4 py-3 font-medium transition-colors ${
                        selected ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1]'
                      }`}
                    >
                      <span className="inline-flex items-center justify-center gap-2">
                        <Icon className="w-4 h-4" />
                        {t(`request_form.user_type_${type}`)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-white/70 mb-2">
                {t('request_form.name')} *
              </label>
              <input
                type="text"
                id="name"
                required
                maxLength={100}
                autoComplete="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={FIELD}
                placeholder={t('request_form.name_placeholder')}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-white/70 mb-2">
                {t('request_form.email')} *
              </label>
              <input
                type="email"
                id="email"
                required
                autoComplete="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={FIELD}
                placeholder={t('request_form.email_placeholder')}
              />
            </div>

            {/* Honeypot: off-screen, not focusable, ignored by password managers. */}
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="company">{t('request_form.honeypot_label')}</label>
              <input
                type="text"
                id="company"
                name="company"
                tabIndex={-1}
                autoComplete="off"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              />
            </div>

            <div>
              <label htmlFor="topic" className="block text-sm font-semibold text-white/70 mb-2">
                {t('request_form.category')} *
              </label>
              <select
                id="topic"
                required
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                className={`${FIELD} appearance-none`}
              >
                <option value="">{t('request_form.select_category')}</option>
                {TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {t(`request_form.topics.${topic}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-semibold text-white/70 mb-2">
                {t('request_form.subject')} *
              </label>
              <input
                type="text"
                id="subject"
                required
                maxLength={200}
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className={FIELD}
                placeholder={t('request_form.subject_placeholder')}
              />
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-semibold text-white/70 mb-2">
                {t('request_form.message')} *
              </label>
              <textarea
                id="message"
                required
                minLength={10}
                maxLength={5000}
                rows={6}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className={`${FIELD} resize-none`}
                placeholder={t('request_form.message_placeholder')}
              />
              <p className="text-xs text-white/50 mt-1">{t('request_form.details_hint')}</p>
            </div>

            {status.kind === 'error' && (
              <div role="alert" className="rounded bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {status.message}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-8 py-3 bg-white hover:bg-white/90 text-black font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('request_form.submitting')}
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    {t('request_form.submit')}
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 p-4 bg-white/[0.03] rounded">
          <p className="text-sm text-white/65">
            <strong className="inline-flex items-center gap-2">
              <Info className="w-4 h-4" />
              {t('tip.title')}:
            </strong>{' '}
            {t('tip.body_prefix')}
            <Link href="/support" className="underline hover:text-white">
              {t('tip.body_link')}
            </Link>
            {t('tip.body_suffix')}
          </p>
        </div>
      </div>
    </div>
  )
}
