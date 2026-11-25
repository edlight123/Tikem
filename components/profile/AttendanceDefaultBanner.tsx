'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NoticeStrip } from '@/components/ui/NoticeStrip'

/**
 * One-time notice (owner decision, 2026-10): attendance visibility now defaults
 * to "Friends". Rendered only for a signed-in user who never chose a setting
 * (the server passes `show`). Dismissing it, or following the link to the
 * privacy settings, stamps `users.attendance_default_notice_seen_at` through
 * /api/profile/update (the server writes its own time), so it shows once per
 * account on every device. Mobile shows the same notice on Home.
 *
 * One line (owner, TestFlight 2026-11-25: the full announcement card was a
 * "big ass card"): the house NoticeStrip.
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
    <NoticeStrip
      icon={Eye}
      text={t('attendance_notice.text')}
      action={{ label: t('attendance_notice.settings'), href: '/profile#privacy', onClick: markSeen }}
      onDismiss={markSeen}
      dismissLabel={t('attendance_notice.dismiss')}
      className={className}
    />
  )
}
