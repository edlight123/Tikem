'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserProfile } from '@/lib/firestore/user-profile'
import { ProfileSection, Panel, PanelRows, SwitchRow } from './ui'
import { readUserNotifyPrefs, type UserNotifyField, type UserNotifyPrefs } from '@/lib/notifications/userPreferences'

interface NotificationsCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

/**
 * The attendee notification switches. Each one writes the top-level
 * users/{uid}.notify_* field the senders read (lib/notifications/policy.ts),
 * the same fields the mobile app's notification settings write. The old card
 * saved a nested `notify` object no sender ever looked at.
 *
 * Before: a bordered card, an empty 40px box around a `text-brand-600` bell, and
 * three copies of the same toggle markup whose knob was `bg-white/[0.03]` —
 * invisible on both a teal and a grey track, so the control's state was carried
 * by the track alone. The closing note was `bg-white/[0.03] border
 * border-white/10`: a hairline around a footnote.
 *
 * Now: one filled panel, hairline-divided rows (the one place a line is the
 * meaning), the shared Switch with a white knob, and the note as plain muted
 * type under the panel — a footnote does not need a box.
 */
export function NotificationsCard({ profile, onUpdate }: NotificationsCardProps) {
  const { t } = useTranslation('profile')
  // The top-level notify_* switches the senders read (policy.ts). The server
  // fills `notifyPrefs`, already falling back to the old nested `notify`
  // values; the fallback here only covers a profile read without it.
  const [prefs, setPrefs] = useState<UserNotifyPrefs>(
    () => profile.notifyPrefs ?? readUserNotifyPrefs({ notify: profile.notify })
  )
  const [isUpdating, setIsUpdating] = useState(false)

  const handleToggle = async (key: UserNotifyField) => {
    const previous = prefs
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setIsUpdating(true)
    try {
      // The whole set: the parent merges this into its profile state, so a
      // partial object would blank the other switches on the next mount.
      await onUpdate({ notifyPrefs: next })
    } catch (error) {
      console.error('Failed to update notifications:', error)
      setPrefs(previous)
    } finally {
      setIsUpdating(false)
    }
  }

  const rows: { key: UserNotifyField; title: string; description: string }[] = [
    { key: 'notify_reminders', title: t('notifications.event_reminders'), description: t('notifications.event_reminders_desc') },
    { key: 'notify_event_updates', title: t('notifications.event_updates'), description: t('notifications.event_updates_desc') },
    { key: 'notify_discovery', title: t('notifications.discovery'), description: t('notifications.discovery_desc') },
    { key: 'notify_filling_fast', title: t('notifications.filling_fast'), description: t('notifications.filling_fast_desc') },
    { key: 'notify_national_day', title: t('notifications.national_day'), description: t('notifications.national_day_desc') },
  ]

  return (
    <ProfileSection title={t('notifications.title')} description={t('notifications.subtitle')}>
      <Panel>
        <PanelRows>
          {rows.map((r) => (
            <SwitchRow
              key={r.key}
              title={r.title}
              description={r.description}
              checked={prefs[r.key]}
              onChange={() => handleToggle(r.key)}
              disabled={isUpdating}
            />
          ))}
        </PanelRows>
      </Panel>

      <p className="mt-3 !text-[12px] !leading-relaxed text-white/35">{t('notifications.note')}</p>
    </ProfileSection>
  )
}
