'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
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

  return (
    <div className={`relative rounded-2xl bg-white/[0.06] p-4 pr-12 sm:p-5 sm:pr-14 ${className}`} role="status">
      <button
        type="button"
        onClick={markSeen}
        aria-label={t('attendance_notice.dismiss')}
        className="absolute right-3 top-3 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      <p className="text-sm leading-relaxed text-white/85">{t('attendance_notice.body')}</p>
      <Link
        href="/profile#privacy"
        onClick={markSeen}
        className="mt-3 inline-flex items-center rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {t('attendance_notice.cta')}
      </Link>
    </div>
  )
}
