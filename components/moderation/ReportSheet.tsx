'use client'

/**
 * "Report event" / "Report organizer" (App Store guideline 1.2). A reason, an
 * optional note, and a POST to /api/events/[id]/report or
 * /api/organizers/[id]/report. Copy is localized off the server's `code`,
 * never its English `error` string.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'

export const REPORT_REASONS = [
  'spam',
  'scam_or_fraud',
  'offensive',
  'violence',
  'sexual',
  'illegal',
  'misleading',
  'other',
] as const
type Reason = (typeof REPORT_REASONS)[number]

const MAX_DETAILS = 1000

export default function ReportSheet({
  isOpen,
  onClose,
  kind,
  targetId,
}: {
  isOpen: boolean
  onClose: () => void
  kind: 'event' | 'organizer'
  targetId: string
}) {
  const { t } = useTranslation('common')
  const [reason, setReason] = useState<Reason | null>(null)
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'sent' | 'duplicate' | null>(null)

  useEffect(() => {
    if (isOpen) {
      setReason(null)
      setDetails('')
      setSending(false)
      setError('')
      setDone(null)
    }
  }, [isOpen])

  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    setError('')
    try {
      const path = kind === 'event' ? `/api/events/${encodeURIComponent(targetId)}/report` : `/api/organizers/${encodeURIComponent(targetId)}/report`
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, details: details.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = String(data?.code || '')
        const known = ['rate_limited', 'unauthorized', 'not_found', 'self_report']
        setError(t(`moderation.errors.${known.includes(code) ? code : 'generic'}`))
        return
      }
      setDone(data?.duplicate ? 'duplicate' : 'sent')
    } catch {
      setError(t('moderation.errors.generic'))
    } finally {
      setSending(false)
    }
  }

  const title = done
    ? t('moderation.success_title')
    : kind === 'event'
      ? t('moderation.report_event_title')
      : t('moderation.report_organizer_title')

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      {done ? (
        <div className="pb-2">
          <p className="text-[15px] leading-relaxed text-white/70">
            {done === 'duplicate' ? t('moderation.already_reported') : t('moderation.success_body')}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 h-12 w-full rounded-xl bg-white text-[15px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            {t('moderation.done')}
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-white/60">{t('moderation.report_intro')}</p>
          <div role="radiogroup" className="divide-y divide-white/[0.06]">
            {REPORT_REASONS.map((key) => {
              const selected = reason === key
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setReason(key)}
                  className="flex w-full items-center justify-between py-3 text-left text-[15px] text-white"
                >
                  {t(`moderation.reasons.${key}`)}
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full ${selected ? 'bg-white text-black' : 'bg-white/[0.08]'}`}
                    aria-hidden
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              )
            })}
          </div>

          <label className="mt-4 block text-[13px] text-white/60" htmlFor="report-details">
            {t('moderation.details_label')}
          </label>
          <textarea
            id="report-details"
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, MAX_DETAILS))}
            maxLength={MAX_DETAILS}
            rows={3}
            placeholder={t('moderation.details_placeholder')}
            className="mt-1.5 w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2.5 text-[16px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/30 sm:text-sm"
          />
          <p className="mt-1 text-right text-xs tabular-nums text-white/40">
            {details.length}/{MAX_DETAILS}
          </p>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={!reason || sending}
            className="mt-4 h-12 w-full rounded-xl bg-white text-[15px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? t('moderation.submitting') : t('moderation.submit')}
          </button>
          <p className="mt-3 text-center text-xs text-white/45">{t('moderation.contact_line')}</p>
        </div>
      )}
    </BottomSheet>
  )
}
