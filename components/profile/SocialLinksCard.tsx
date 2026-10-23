'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Instagram, Music2, Twitter, Facebook, Check, X, Pencil } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import type { UserProfile } from '@/lib/firestore/user-profile'
import type { SocialLinks } from '@/types/social'
import { FIELD, GHOST_BTN, WHITE_BTN, ProfileSection, Panel, PanelRows, FieldLabel } from './ui'

interface SocialLinksCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

/**
 * Bio + the four handles.
 *
 * Before: a bordered card opening with a `bg-pink-50` icon tile (a near-white
 * pink square on black), four platform icons in their own brand colours fighting
 * each other, a textarea and four `@`-prefixed inputs that were all borders and
 * no fill, and an "we don't verify these" notice built as `border
 * border-amber-200` — Tailwind's LIGHT amber, so a near-white hairline around
 * empty space.
 *
 * Now: the serif section heading carries the identity, so the pink tile is gone;
 * the icons are monochrome (they identify a row, they don't shout); bio and
 * handles are rows of one filled panel; and the notice is an amber WASH with no
 * border.
 */
const PLATFORMS: Array<{
  key: keyof SocialLinks
  /** Platform names are brands: the same in every language. */
  label: string
  /** profile:social.* key for the example handle. */
  placeholderKey: 'handle_placeholder' | 'profile_placeholder'
  Icon: typeof Instagram
}> = [
  { key: 'instagram', label: 'Instagram', placeholderKey: 'handle_placeholder', Icon: Instagram },
  { key: 'tiktok', label: 'TikTok', placeholderKey: 'handle_placeholder', Icon: Music2 },
  { key: 'twitter', label: 'X (Twitter)', placeholderKey: 'handle_placeholder', Icon: Twitter },
  { key: 'facebook', label: 'Facebook', placeholderKey: 'profile_placeholder', Icon: Facebook },
]

export function SocialLinksCard({ profile, onUpdate }: SocialLinksCardProps) {
  const { t } = useTranslation('profile')
  const { showToast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [bio, setBio] = useState(profile.bio || '')
  const [links, setLinks] = useState<SocialLinks>({
    instagram: profile.socialLinks?.instagram || '',
    tiktok: profile.socialLinks?.tiktok || '',
    twitter: profile.socialLinks?.twitter || '',
    facebook: profile.socialLinks?.facebook || '',
  })

  const handleSave = async () => {
    setIsLoading(true)
    try {
      await onUpdate({ bio, socialLinks: links })
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to update social links:', error)
      showToast({ type: 'error', title: t('social.save_error') })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setBio(profile.bio || '')
    setLinks({
      instagram: profile.socialLinks?.instagram || '',
      tiktok: profile.socialLinks?.tiktok || '',
      twitter: profile.socialLinks?.twitter || '',
      facebook: profile.socialLinks?.facebook || '',
    })
    setIsEditing(false)
  }

  const hasAnyLink = PLATFORMS.some((p) => (profile.socialLinks?.[p.key] || '').trim())

  return (
    <ProfileSection
      title={t('social.title')}
      description={t('social.subtitle')}
      actions={
        !isEditing ? (
          <button onClick={() => setIsEditing(true)} className={GHOST_BTN}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('social.edit')}
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
      }
    >
      <Panel>
        <PanelRows>
          {/* Bio */}
          <div className="px-4 py-4 sm:px-5">
            <FieldLabel htmlFor="profile-bio" className="mb-2">
              {t('social.bio')}
            </FieldLabel>
            {isEditing ? (
              <>
                <textarea
                  id="profile-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 280))}
                  rows={3}
                  placeholder={t('social.bio_placeholder')}
                  className={`${FIELD} resize-none`}
                />
                <p className="mt-1.5 text-right !text-[12px] text-white/35">{bio.length}/280</p>
              </>
            ) : (
              <p className="!text-[15px] !leading-relaxed whitespace-pre-line text-white/80">
                {profile.bio?.trim() ? profile.bio : <span className="text-white/35">{t('social.no_bio')}</span>}
              </p>
            )}
          </div>

          {/* Handles. Read mode hides the empty ones; edit mode shows all four. */}
          {PLATFORMS.map(({ key, label, placeholderKey, Icon }) => {
            const value = isEditing ? links[key] || '' : profile.socialLinks?.[key] || ''
            if (!isEditing && !value) return null
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/55">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl bg-white/[0.06] focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-500">
                    <span className="select-none pl-3.5 pr-1 text-[16px] text-white/35">@</span>
                    <input
                      type="text"
                      value={links[key] || ''}
                      onChange={(e) => setLinks((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={t(`social.${placeholderKey}`)}
                      className="min-w-0 flex-1 bg-transparent py-3 pr-3.5 text-[16px] text-white outline-none placeholder:text-white/35"
                      aria-label={label}
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    {/* A span, not a p: `.mobile-typography p` (element+class)
                        would override .eyebrow's size and line-height. */}
                    <span className="eyebrow block text-white/40">{label}</span>
                    <p className="mt-0.5 truncate !text-[15px] font-semibold text-white">@{value}</p>
                  </div>
                )}
              </div>
            )
          })}

          {!isEditing && !hasAnyLink && (
            <p className="px-4 py-4 !text-[14px] text-white/35 sm:px-5">{t('social.no_links')}</p>
          )}
        </PanelRows>
      </Panel>

      {isEditing && (
        <div className="mt-3 rounded-xl bg-amber-400/[0.08] px-4 py-3">
          <p className="!text-[12px] !leading-relaxed text-amber-200/85">{t('social.notice')}</p>
        </div>
      )}
    </ProfileSection>
  )
}
