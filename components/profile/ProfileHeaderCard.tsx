'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { User, Mail, Phone, Check, X, Pencil } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import type { UserProfile } from '@/lib/firestore/user-profile'
import { FIELD, GHOST_BTN, WHITE_BTN, Panel, PanelRows, ReadoutRow, FieldLabel } from './ui'

interface ProfileHeaderCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

/**
 * Identity. The top of the page, and the only section without a serif heading —
 * the page title already says "My Profile", so a second "Profile" heading over
 * the reader's own name was noise.
 *
 * Before: a bordered card whose avatar well was `bg-gradient-to-br
 * from-brand-100 to-brand-50` — two near-white teal tints, i.e. a bright blob on
 * a black page — with the name at `text-lg` under a `text-xl` card heading, so
 * the label outranked the person. The two edit inputs were `border
 * border-white/10` with no fill and no text colour, and "Read-only" was a filled
 * chip, which the house rule reserves for surfaces and real toggles.
 *
 * Now: the name IS the headline (it inherits the reader's own eye first), member
 * since sits under it as metadata, and email/phone are read-out rows in one
 * filled panel. Editing swaps each value for a filled field in the same slot, so
 * nothing jumps.
 */
export function ProfileHeaderCard({ profile, onUpdate }: ProfileHeaderCardProps) {
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

  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Recently'

  return (
    <section>
      <div className="flex items-start gap-4 sm:gap-5">
        {/* Avatar well: a fill, not a bright tint. */}
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full bg-white/[0.06] sm:h-24 sm:w-24">
          {profile.photoURL ? (
            <Image
              src={profile.photoURL}
              alt={profile.displayName}
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <User className="h-8 w-8 text-white/30 sm:h-10 sm:w-10" aria-hidden />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div>
              <FieldLabel htmlFor="profile-display-name" className="mb-1.5">
                {t('header.full_name')}
              </FieldLabel>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={FIELD}
                placeholder={t('header.full_name_placeholder')}
              />
            </div>
          ) : (
            /* `!` on size and leading: `.mobile-typography h2` would otherwise
               shrink the reader's own name to 18px on a phone — and it sets
               line-height too, so the leading has to be pinned alongside the
               size or the name lifts onto a leading it was never designed for.
               22px, not 26px: on a 402px phone this column is only 198px wide
               (72px avatar + the Edit button take 172 of the 370px of content),
               so 26px made a two-word name wrap and read LOUDER than the 28px
               serif page title above it. 22px keeps the name the headline of
               its block without outshouting the page. `break-words` because a
               single unbroken 20-character name would otherwise overflow a
               198px column rather than wrap. */
            <h2 className="!text-[22px] !leading-[1.15] break-words font-bold tracking-[-0.02em] text-white sm:!text-[32px]">
              {profile.displayName || t('header.phone_not_set')}
            </h2>
          )}
          <p className="mt-1.5 !text-[13px] text-white/40">
            {t('header.member_since')} {memberSince}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} className={GHOST_BTN}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('header.edit_profile')}
            </button>
          ) : (
            <>
              <button onClick={handleCancel} disabled={isLoading} className={GHOST_BTN}>
                <X className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t('header.cancel')}</span>
              </button>
              <button onClick={handleSave} disabled={isLoading} className={WHITE_BTN}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                {isLoading ? t('header.saving') : t('header.save')}
              </button>
            </>
          )}
        </div>
      </div>

      <Panel className="mt-5 sm:mt-6">
        <PanelRows>
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
    </section>
  )
}
