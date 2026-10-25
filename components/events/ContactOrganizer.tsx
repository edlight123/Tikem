'use client'

/**
 * "Message the organizer" on the public event page: the web twin of
 * mobile/components/ContactOrganizerModal. A topic (the event / my ticket /
 * other), a free-text message, and a POST to /api/events/contact-organizer,
 * which drops it in the organizer's inbox and opens a two-way thread the
 * attendee follows from /profile#messages. Neither side's email address is
 * revealed to the other, which is why this is not a mailto: link.
 *
 * Signed out, the row sends the visitor to sign in and back to this event.
 * The caller hides it on the organizer's own event (the server refuses a
 * self-contact anyway).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ChevronRight, MessageCircle } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'

/** Mirrors the route's TOPICS union; anything else is rejected. */
const TOPICS = ['event', 'ticket', 'other'] as const
type Topic = (typeof TOPICS)[number]

/** Mirrors MAX_MESSAGE_LENGTH in app/api/events/contact-organizer/route.ts. */
const MAX_MESSAGE_LENGTH = 1000

/** Route error codes with their own copy; anything else reads as generic. */
const KNOWN_ERRORS = [
  'unauthorized',
  'rate_limited',
  'self_contact',
  'event_not_found',
  'no_organizer',
  'message_too_long',
] as const

interface ContactOrganizerProps {
  eventId: string
  eventTitle?: string
  userId: string | null | undefined
  className?: string
}

export default function ContactOrganizer({ eventId, eventTitle, userId, className = '' }: ContactOrganizerProps) {
  const { t } = useTranslation('common')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState<Topic>('event')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  // Reopening after a send presents a blank form, not the old success state or
  // a stale error from last time.
  useEffect(() => {
    if (open) {
      setTopic('event')
      setMessage('')
      setSending(false)
      setError('')
      setSent(false)
    }
  }, [open])

  const toLogin = () => {
    const redirectTo = `${window.location.pathname}${window.location.search || ''}`
    router.push(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`)
  }

  const canSend = message.trim().length > 0 && !sending

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/events/contact-organizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, topic, message: message.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const code = String(data?.code || '')
        const key = (KNOWN_ERRORS as readonly string[]).includes(code) ? code : 'generic'
        setError(t(`contactOrganizer.errors.${key}`))
        return
      }
      setSent(true)
    } catch {
      setError(t('contactOrganizer.errors.generic'))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* A filled row, as in the app's "Hosted by" card: icon tile, label, chevron. */}
      <button
        type="button"
        onClick={() => (userId ? setOpen(true) : toLogin())}
        className={`flex w-full items-center gap-3 rounded bg-white/[0.05] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.09] ${className}`}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-white/[0.08]" aria-hidden>
          <MessageCircle className="h-[17px] w-[17px] text-white" />
        </span>
        <span className="flex-1 text-[15px] font-medium text-white">{t('contactOrganizer.open')}</span>
        <ChevronRight className="h-4 w-4 text-white/50" aria-hidden />
      </button>

      <BottomSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title={sent ? t('contactOrganizer.sentTitle') : t('contactOrganizer.title')}
      >
        {sent ? (
          <div className="pb-2">
            <p className="!text-[15px] leading-relaxed text-white/70">
              {eventTitle
                ? t('contactOrganizer.sentBodyNamed', { event: eventTitle })
                : t('contactOrganizer.sentBody')}
            </p>
            <a
              href="/profile#messages"
              className="mt-6 flex h-12 w-full items-center justify-center rounded bg-white/[0.08] text-[15px] font-semibold text-white transition-colors hover:bg-white/[0.12]"
            >
              {t('contactOrganizer.viewMessages')}
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 h-12 w-full rounded bg-white text-[15px] font-semibold text-black transition-opacity hover:opacity-90"
            >
              {t('contactOrganizer.done')}
            </button>
          </div>
        ) : (
          <div>
            {eventTitle && (
              <p className="mb-5 truncate !text-[14px] text-white/60">
                {t('contactOrganizer.aboutEvent', { event: eventTitle })}
              </p>
            )}

            <p id="contact-organizer-topic" className="mb-2.5 !text-[13px] font-semibold text-white/60">
              {t('contactOrganizer.topicLabel')}
            </p>
            {/* Three filled chips; the chosen one inverts to white. No radio
                circles, no outlines (same language as the app). */}
            <div role="radiogroup" aria-labelledby="contact-organizer-topic" className="flex gap-2">
              {TOPICS.map((key) => {
                const selected = topic === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTopic(key)}
                    className={`h-10 min-w-0 flex-1 truncate rounded px-2 text-[14px] font-semibold transition-colors ${
                      selected ? 'bg-white text-black' : 'bg-white/[0.08] text-white hover:bg-white/[0.12]'
                    }`}
                  >
                    {t(`contactOrganizer.topics.${key}`)}
                  </button>
                )
              })}
            </div>

            <label htmlFor="contact-organizer-message" className="sr-only">
              {t('contactOrganizer.messagePlaceholder')}
            </label>
            <textarea
              id="contact-organizer-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={5}
              disabled={sending}
              placeholder={t('contactOrganizer.messagePlaceholder')}
              className="mt-4 min-h-[132px] w-full resize-none rounded bg-white/[0.06] px-4 py-3.5 text-[16px] leading-[22px] text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-60"
            />
            <p className="mt-1.5 text-right !text-[12px] tabular-nums text-white/40">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </p>

            {error && (
              <p role="alert" className="mt-2 !text-[14px] text-red-400">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="mt-4 h-12 w-full rounded bg-white text-[15px] font-semibold text-black transition-opacity hover:opacity-90 disabled:bg-white/[0.08] disabled:text-white/40 disabled:hover:opacity-100"
            >
              {sending ? t('contactOrganizer.sending') : t('contactOrganizer.send')}
            </button>
          </div>
        )}
      </BottomSheet>
    </>
  )
}
