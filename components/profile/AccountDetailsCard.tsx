'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, Mail, Phone, Check, X, Pencil } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import type { UserProfile } from '@/lib/firestore/user-profile'
import { FIELD, GHOST_BTN, WHITE_BTN, ProfileSection, Panel, PanelRows, ReadoutRow } from './ui'

interface AccountDetailsCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

/**
 * Name, email and phone: the "Edit profile" panel of the /profile dashboard.
 *
 * This was the top half of the old ProfileHeaderCard. The avatar (the photo
 * control) and the name as a headline moved up into ProfileIdentity, the
 * dashboard header; what stays here is the editable record. Editing swaps each
 * value for a filled field in the same slot, so nothing jumps.
 */
export function AccountDetailsCard({ profile, onUpdate }: AccountDetailsCardProps) {
  const { t } = useTranslation('profile')
  const { showToast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [phone, setPhone] = useState(profile.phone || '')
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async () => {
    if (!displayName.trim()) {
      showToast({ type: 'error', title: t('header.full_name_required') })
      return
    }

    setIsLoading(true)
    try {
      await onUpdate({ displayName, phone })
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update profile:', error)
      showToast({ type: 'error', title: t('header.save_error') })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setDisplayName(profile.displayName)
    setPhone(profile.phone || '')
    setIsEditing(false)
  }

  const actions = !isEditing ? (
    <button onClick={() => setIsEditing(true)} className={GHOST_BTN}>
      <Pencil className="h-3.5 w-3.5" aria-hidden />
      {t('header.edit_profile')}
    </button>
  ) : (
    <div className="flex items-center gap-2">
      <button onClick={handleCancel} disabled={isLoading} className={GHOST_BTN}>
        <X className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">{t('header.cancel')}</span>
      </button>
      <button onClick={handleSave} disabled={isLoading} className={WHITE_BTN}>
        <Check className="h-3.5 w-3.5" aria-hidden />
        {isLoading ? t('header.saving') : t('header.save')}
      </button>
    </div>
  )

  return (
    <ProfileSection title={t('dashboard.edit_profile')} actions={actions}>
      <Panel>
        <PanelRows>
          <ReadoutRow label={t('header.full_name')} icon={User}>
            {isEditing ? (
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={FIELD}
                placeholder={t('header.full_name_placeholder')}
                aria-label={t('header.full_name')}
              />
            ) : (
              <p className={`!text-[15px] break-words ${profile.displayName ? 'text-white' : 'text-white/35'}`}>
                {profile.displayName || t('header.phone_not_set')}
              </p>
            )}
          </ReadoutRow>

          <ReadoutRow label={t('header.email')} icon={Mail} note={t('header.email_readonly')}>
            <p className="!text-[15px] break-all text-white">{profile.email}</p>
          </ReadoutRow>

          <ReadoutRow label={t('header.phone')} icon={Phone}>
            {isEditing ? (
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={FIELD}
                placeholder={t('header.phone_placeholder')}
                aria-label={t('header.phone')}
              />
            ) : (
              <p className={`!text-[15px] ${profile.phone ? 'text-white' : 'text-white/35'}`}>
                {profile.phone || t('header.phone_not_set')}
              </p>
            )}
          </ReadoutRow>
        </PanelRows>
      </Panel>
    </ProfileSection>
  )
}
