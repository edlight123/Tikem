'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * One-time notice (owner decision, 2026-10): attendance visibility now defaults
 * to "Friends". Rendered only for a signed-in user who never chose a setting
 * (the server passes `show`). Dismissing it, or following the link to the
 * privacy settings, stamps `users.attendance_default_notice_seen_at` through
 * /api/profile/update (the server writes its own time), so it shows once per
 * account on every device. Mobile shows the same notice on Home.
 */
export function AttendanceDefaultBanner({ show, className = '' }: { show: boolean; className?: string }) {
  const { t } = useTranslation('common')
  const [hidden, setHidden] = useState(false)
  if (!show || hidden) return null

  const markSeen = () => {
    setHidden(true)
    fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceDefaultNoticeSeenAt: true }),
    }).catch((err) => console.warn('[attendance-notice] could not record the notice as seen', err))
  }

  // The house announcement (same anatomy as the mobile AnnouncementCard): a
  // fill, a faint teal glow in one corner, an eyebrow row, a serif headline,
  // one line of body, one white pill and a quiet text secondary.
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white/[0.055] p-5 ${className}`}
      role="status"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.10),transparent_70%)]"
      />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/[0.08] text-white/80">
            <Lock className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            {t('attendance_notice.eyebrow')}
          </span>
        </div>
        <h2 className="mt-4 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {t('attendance_notice.title')}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/60">{t('attendance_notice.body')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/profile#privacy"
            onClick={markSeen}
            className="inline-flex h-10 items-center rounded bg-white px-5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {t('attendance_notice.cta')}
          </Link>
          <button
            type="button"
            onClick={markSeen}
            className="text-[13px] font-medium text-white/55 transition-colors hover:text-white focus:outline-none focus-visible:underline"
          >
            {t('attendance_notice.got_it')}
          </button>
        </div>
      </div>
    </div>
  )
}
