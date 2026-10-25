'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * "Join the waitlist" for a sold-out event whose organizer turned the waitlist
 * on (the web twin of mobile/components/JoinWaitlistButton). Joining goes
 * through POST /api/waitlist/join; when seats free up, lib/waitlist.ts emails
 * everyone waiting (once per release).
 */
export default function JoinWaitlistButton({
  eventId,
  userId,
  compact = false,
}: {
  eventId: string
  userId: string | null
  /** The sticky mobile bar: button only, no explanation line. */
  compact?: boolean
}) {
  const { t } = useTranslation('common')
  const [loading, setLoading] = useState(!!userId)
  const [joining, setJoining] = useState(false)
  const [position, setPosition] = useState<number | null>(null)
  const [onList, setOnList] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/waitlist/join?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.onWaitlist) {
        setOnList(true)
        setPosition(Number(data.position) || null)
      }
    } catch {
      // Unknown: show the join button; joining again is idempotent.
    } finally {
      setLoading(false)
    }
  }, [eventId, userId])

  useEffect(() => {
    load()
  }, [load])

  async function join() {
    setJoining(true)
    setError(null)
    try {
      const res = await fetch('/api/waitlist/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          data?.code === 'tickets_available'
            ? t('events.waitlist_tickets_available')
            : t('events.waitlist_error')
        )
        return
      }
      setOnList(true)
      setPosition(Number(data?.position) || null)
    } catch {
      setError(t('events.waitlist_error'))
    } finally {
      setJoining(false)
    }
  }

  const primary =
    'block w-full min-h-12 rounded bg-white px-5 py-2.5 text-center text-[15px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50'
  const passive =
    'flex w-full min-h-12 items-center justify-center rounded bg-white/[0.06] px-5 py-2.5 text-center text-[15px] font-semibold text-white/80'

  if (!userId) {
    const loginHref = `/auth/login?redirect=${encodeURIComponent(`/events/${eventId}`)}`
    return (
      <div className="space-y-2">
        <Link href={loginHref} className={primary}>
          {t('events.waitlist_sign_in')}
        </Link>
        {!compact && <p className="text-sm text-white/60">{t('events.waitlist_join_desc')}</p>}
      </div>
    )
  }

  if (loading) {
    return <div className="h-12 w-full animate-pulse rounded bg-white/[0.06]" aria-hidden="true" />
  }

  if (onList) {
    return (
      <div className="space-y-2">
        <div className={passive} role="status">
          {position
            ? t('events.waitlist_on_position', { position })
            : t('events.waitlist_on')}
        </div>
        {!compact && <p className="text-sm text-white/60">{t('events.waitlist_on_desc')}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={join} disabled={joining} className={primary}>
        {joining ? t('events.waitlist_joining') : t('events.waitlist_join')}
      </button>
      {error ? (
        <p className="text-sm text-red-300" role="alert">{error}</p>
      ) : (
        !compact && <p className="text-sm text-white/60">{t('events.waitlist_join_desc')}</p>
      )}
    </div>
  )
}
