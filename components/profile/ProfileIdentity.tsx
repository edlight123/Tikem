'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Camera, Loader2, MapPin, Pencil } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import type { UserProfile } from '@/lib/firestore/user-profile'

interface ProfileIdentityProps {
  profile: UserProfile
  stats: { attended: number; following: number; followers: number }
  /** Opens the "Edit profile" panel (name, phone, bio, socials). */
  onEdit: () => void
  /** Opens the "Following" panel (/profile#following). */
  onOpenFollowing: () => void
}

/**
 * The dashboard header, the web twin of the mobile ProfileScreen hero: the
 * avatar IS the photo control (camera badge, file picker, writes
 * users.photo_url through /api/profile/upload-photo), then the name as the
 * headline, the city, and the stat line.
 *
 * On a phone it stacks like the app: identity, then three numerals across.
 * From `lg` the stats move to the right of the identity so the band uses the
 * width instead of leaving a column of dead space beside a 112px circle.
 *
 * Stats are big numerals over tiny captions with no rules between them (the
 * mobile treatment). "Attended" opens /tickets and Following opens the
 * Following panel; Followers stays a count only, because who follows you is
 * private.
 */
export function ProfileIdentity({ profile, stats, onEdit, onOpenFollowing }: ProfileIdentityProps) {
  const { t, i18n } = useTranslation('profile')
  const { showToast } = useToast()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoURL, setPhotoURL] = useState(profile.photoURL || '')
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)

  const name = (profile.displayName || '').trim() || profile.email || ''
  const initial = (name || '?').charAt(0).toUpperCase()
  const city = (profile.defaultCity || '').trim()
  const verification = profile.verificationStatus || ''
  const isVerified = verification === 'approved'
  const isPending = ['pending', 'pending_review', 'in_review'].includes(verification)

  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'fr-FR', {
        month: 'long',
        year: 'numeric',
      })
    : ''

  const handlePhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      showToast({ type: 'error', title: t('header.photo_invalid') })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast({ type: 'error', title: t('header.photo_too_large') })
      return
    }

    setIsUploadingPhoto(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/profile/upload-photo', { method: 'POST', body })
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: '' }))
        throw new Error(error || 'Upload failed')
      }
      const { photo_url } = await response.json()
      setPhotoURL(photo_url)
      showToast({ type: 'success', title: t('header.photo_updated') })
      router.refresh()
    } catch (error) {
      console.error('Failed to upload profile photo:', error)
      showToast({ type: 'error', title: t('header.photo_error') })
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  const statCells: Array<{ key: string; label: string; value: number; href?: string; onClick?: () => void }> = [
    { key: 'attended', label: t('dashboard.stats.attended'), value: stats.attended, href: '/tickets' },
    { key: 'following', label: t('dashboard.stats.following'), value: stats.following, onClick: onOpenFollowing },
    { key: 'followers', label: t('dashboard.stats.followers'), value: stats.followers },
  ]

  return (
    <section className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
        {/* Avatar: a circle (avatars are one of the few true circles). The
            whole well is the photo button; the camera badge says so. */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploadingPhoto}
          aria-label={t('header.change_photo')}
          title={t('header.change_photo')}
          className="group relative h-[84px] w-[84px] shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-wait sm:h-28 sm:w-28"
        >
          <span className="block h-full w-full overflow-hidden rounded-full bg-white/[0.08]">
            {photoURL ? (
              <Image
                src={photoURL}
                alt={name}
                width={112}
                height={112}
                className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
              />
            ) : (
              // The initial, not a generic person glyph: the name is right
              // beside it, and the circle stays the tap target for a photo.
              <span className="grid h-full w-full place-items-center font-display text-[36px] text-white/80 sm:text-[46px]">
                {initial}
              </span>
            )}
          </span>
          {isUploadingPhoto ? (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/60">
              <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
            </span>
          ) : null}
          <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full bg-white text-black ring-[3px] ring-[#0a0a0a] transition-transform group-hover:scale-105 sm:h-8 sm:w-8">
            <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handlePhotoPicked}
          className="hidden"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {/* `!` on size and leading: `.mobile-typography h1` would shrink the
                name to 20px on a phone and reset its leading. */}
            <h1 className="min-w-0 break-words font-display !text-[30px] !leading-[1.02] text-white sm:!text-[44px]">
              {name}
            </h1>
            {isVerified ? (
              <BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-brand-400 sm:mt-2 sm:h-6 sm:w-6" aria-label={t('organizer_profile.verified')} />
            ) : null}
            <button
              type="button"
              onClick={onEdit}
              aria-label={t('dashboard.edit_profile')}
              title={t('dashboard.edit_profile')}
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded bg-white/[0.06] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {city ? (
              <span className="inline-flex items-center gap-1.5 text-[14px] text-white/60">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {city}
              </span>
            ) : null}
            {isPending ? (
              // A dot and a label, never a filled status pill (house rule).
              <span className="eyebrow inline-flex items-center gap-1.5 text-[11px] text-white/55">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {t('dashboard.verification_pending')}
              </span>
            ) : null}
            {memberSince ? (
              <span className="text-[13px] text-white/40">
                {t('header.member_since')} {memberSince}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-end gap-6 lg:gap-8">
        <div className="grid flex-1 grid-cols-3 gap-2 rounded bg-white/[0.03] px-2 py-4 lg:flex-none lg:gap-8 lg:bg-transparent lg:p-0">
          {statCells.map((s) => {
            const body = (
              <>
                <span className="text-[26px] font-semibold leading-none tabular-nums text-white sm:text-[32px]">
                  {s.value}
                </span>
                {/* Wraps to two centred lines rather than truncating: Kreyòl labels
                    like "Moun ki swiv ou" are wider than a third of a phone. */}
                <span className="mt-2 text-balance text-center text-[11px] uppercase leading-tight tracking-[0.06em] text-white/45 sm:tracking-[0.12em] lg:text-left">
                  {s.label}
                </span>
              </>
            )
            const linkClass =
              'flex min-w-0 flex-col items-center rounded px-1 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:items-start lg:px-0 lg:hover:bg-transparent lg:hover:opacity-80'
            return s.href ? (
              <Link key={s.key} href={s.href} className={linkClass}>
                {body}
              </Link>
            ) : s.onClick ? (
              <button key={s.key} type="button" onClick={s.onClick} className={linkClass}>
                {body}
              </button>
            ) : (
              <div key={s.key} className="flex min-w-0 flex-col items-center px-1 lg:items-start lg:px-0">
                {body}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="hidden h-10 items-center gap-2 rounded bg-white/[0.06] px-4 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:inline-flex"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {t('dashboard.edit_profile')}
        </button>
      </div>
    </section>
  )
}
