'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BookOpen,
  Camera,
  ChevronRight,
  Compass,
  ExternalLink,
  FileText,
  Instagram,
  Loader2,
  RotateCcw,
  Shield,
  Users,
  HelpCircle,
} from 'lucide-react'
import OrganizerMark from '@/components/OrganizerMark'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { EmptyState } from '@/components/ui/kit'
import { useToast } from '@/components/ui/Toast'
import { ProfileSection, Panel, PanelRows } from './ui'

/**
 * The /profile dashboard modules, one per block of the mobile ProfileScreen:
 * organization, find your people, the poster wall, view as, settings rows and
 * help. ProfileClient decides where each one sits at each width.
 */

import { INSTAGRAM_URL, openInstagram } from '@/lib/instagram'

/* ------------------------------------------------------------------ */
/* Organization                                                        */
/* ------------------------------------------------------------------ */

/**
 * The brand shown in place of the personal name, with the logo changeable
 * right here (the same upload the organization settings page uses). The name
 * opens organization settings, where it is edited.
 */
export function OrganizationCard({ name, logo }: { name: string; logo: string }) {
  const { t } = useTranslation('profile')
  const { showToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [logoUrl, setLogoUrl] = useState(logo)
  const [uploading, setUploading] = useState(false)

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
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
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/organizer/settings/organization/upload-logo', { method: 'POST', body })
      if (!res.ok) throw new Error('upload failed')
      const { logo_url } = await res.json()
      setLogoUrl(logo_url)
      showToast({ type: 'success', title: t('dashboard.organization.logo_updated') })
    } catch (err) {
      console.error('Failed to upload organization logo:', err)
      showToast({ type: 'error', title: t('dashboard.organization.logo_error') })
    } finally {
      setUploading(false)
    }
  }

  const actionLabel = logoUrl ? t('dashboard.organization.change_logo') : t('dashboard.organization.add_logo')

  return (
    <ProfileSection title={t('dashboard.organization.title')}>
      <Panel className="flex items-center gap-4 p-4 sm:p-5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label={actionLabel}
          className="group relative shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-wait"
        >
          <OrganizerMark logoUrl={logoUrl} className="h-14 w-14 rounded transition-opacity group-hover:opacity-80" />
          {uploading ? (
            <span className="absolute inset-0 grid place-items-center rounded bg-black/60">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
            </span>
          ) : null}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={onPicked}
          className="hidden"
        />
        <Link
          href="/organizer/settings/organization"
          className="min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <span className={`block truncate !text-[16px] font-semibold ${name ? 'text-white' : 'text-white/45'}`}>
            {name || t('dashboard.organization.empty_name')}
          </span>
          <span className="mt-0.5 line-clamp-2 block !text-[13px] !leading-snug text-white/50">
            {t('dashboard.organization.hint')}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="hidden shrink-0 items-center gap-1.5 rounded bg-white/[0.06] px-3 py-2 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 sm:inline-flex"
        >
          <Camera className="h-3.5 w-3.5" aria-hidden />
          {actionLabel}
        </button>
      </Panel>
    </ProfileSection>
  )
}

/* ------------------------------------------------------------------ */
/* Find your people                                                    */
/* ------------------------------------------------------------------ */

/**
 * The way into Friends > Find (suggestions, contact matching, invite link).
 * The house announcement anatomy, as on mobile: a fill, a faint teal glow in
 * one corner, an eyebrow with a dot, a serif headline, one line, one white CTA.
 * No counts: nothing is fetched here that could back one.
 */
export function FindFriendsCard() {
  const { t } = useTranslation('profile')
  return (
    <section className="relative overflow-hidden rounded bg-white/[0.055] p-5 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.10),transparent_70%)]"
      />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white/[0.08] text-white/80">
            <Users className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            {t('dashboard.find_friends.eyebrow')}
          </span>
        </div>
        <h2 className="mt-4 font-display lowercase italic !text-[24px] !leading-snug text-white">
          {t('dashboard.find_friends.title')}
        </h2>
        <p className="mt-1.5 max-w-lg !text-[14px] !leading-relaxed text-white/60">{t('dashboard.find_friends.body')}</p>
        <Link
          href="/connections?tab=find"
          className="mt-4 inline-flex h-10 items-center gap-2 rounded bg-white px-5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {t('dashboard.find_friends.cta')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Poster wall                                                         */
/* ------------------------------------------------------------------ */

/** Every event the reader holds a ticket to, newest first, as posters. */
export function PostersSection({ posters, total }: { posters: any[]; total: number }) {
  const { t } = useTranslation('profile')
  return (
    <ProfileSection
      title={t('dashboard.posters.title')}
      actions={
        total > 0 ? (
          <Link
            href="/tickets"
            className="eyebrow group inline-flex items-center gap-1 whitespace-nowrap rounded pb-1 text-[11px] text-white/55 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {t('dashboard.posters.see_all')}
            {total > posters.length ? <span className="tabular-nums text-white/35">({total})</span> : null}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {posters.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4">
          {posters.map((event) => (
            <DiscoverEventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Compass}
          title={t('dashboard.posters.empty_title')}
          description={t('dashboard.posters.empty_body')}
          className="!p-8"
          action={
            <Link
              href="/discover"
              className="inline-flex h-10 items-center rounded bg-white px-5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {t('dashboard.posters.explore')}
            </Link>
          }
        />
      )}
    </ProfileSection>
  )
}

/* ------------------------------------------------------------------ */
/* View as                                                             */
/* ------------------------------------------------------------------ */

/**
 * The mobile mode switch. On the web the modes are places, not a stored
 * setting: you are on the attendee side here, Organizer is the /organizer
 * console and Staff is /staff. Shown only when the account has more than one
 * hat, as on mobile. Selected = a raised fill with the teal ring on top.
 */
export function ViewAsSection({ canOrganize, canStaff }: { canOrganize: boolean; canStaff: boolean }) {
  const { t } = useTranslation('profile')
  if (!canOrganize && !canStaff) return null
  const base =
    'flex h-11 flex-1 items-center justify-center rounded px-4 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
  return (
    <ProfileSection title={t('dashboard.view_as.title')}>
      <div className="flex gap-2" role="group" aria-label={t('dashboard.view_as.title')}>
        <span aria-current="page" className={`${base} bg-white/[0.08] text-white ring-1 ring-inset ring-brand-500`}>
          {t('dashboard.view_as.attendee')}
        </span>
        {canOrganize ? (
          <Link href="/organizer" className={`${base} bg-white/[0.055] text-white/70 hover:bg-white/[0.12] hover:text-white`}>
            {t('dashboard.view_as.organizer')}
          </Link>
        ) : null}
        {canStaff ? (
          <Link href="/staff" className={`${base} bg-white/[0.055] text-white/70 hover:bg-white/[0.12] hover:text-white`}>
            {t('dashboard.view_as.staff')}
          </Link>
        ) : null}
      </div>
      <p className="mt-2.5 !text-[12px] !leading-relaxed text-white/40">
        {[canOrganize ? t('dashboard.view_as.tip_organizer') : '', canStaff ? t('dashboard.view_as.tip_staff') : '']
          .filter(Boolean)
          .join(' ')}
      </p>
    </ProfileSection>
  )
}

/* ------------------------------------------------------------------ */
/* Settings + help rows                                                */
/* ------------------------------------------------------------------ */

type IconType = React.ComponentType<{ className?: string }>

export type SettingsRow =
  | { kind: 'panel'; id: string; icon: IconType; label: string; description?: string }
  | { kind: 'link'; href: string; icon: IconType; label: string; description?: string; external?: boolean; trailing?: string }

const ROW =
  'group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500'

function RowBody({ icon: Icon, label, description }: { icon: IconType; label: string; description?: string }) {
  return (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-white/[0.06] text-white/55 transition-colors group-hover:text-white/85">
        <Icon className="h-[17px] w-[17px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate !text-[15px] font-semibold text-white">{label}</span>
        {description ? (
          <span className="mt-0.5 block truncate !text-[12.5px] !leading-snug text-white/45">{description}</span>
        ) : null}
      </span>
    </>
  )
}

/** One filled panel of rows: a panel row opens a settings panel, a link row navigates. */
export function RowList({
  title,
  rows,
  activeId,
  onOpen,
}: {
  title: string
  rows: SettingsRow[]
  activeId?: string | null
  onOpen?: (id: string) => void
}) {
  return (
    <ProfileSection title={title}>
      <Panel>
        <PanelRows>
          {rows.map((row) => {
            if (row.kind === 'panel') {
              const active = activeId === row.id
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onOpen?.(row.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`${ROW} ${active ? 'bg-white/[0.07]' : ''}`}
                >
                  <RowBody icon={row.icon} label={row.label} description={row.description} />
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-brand-400' : 'text-white/25 group-hover:text-white/60'}`}
                    aria-hidden
                  />
                </button>
              )
            }
            const trailing = row.external ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-white/40">
                {row.trailing}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-white/25 transition-colors group-hover:text-white/60" aria-hidden />
            )
            return row.external ? (
              <a
                key={row.href}
                href={row.href}
                onClick={row.href === INSTAGRAM_URL ? openInstagram : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={ROW}
              >
                <RowBody icon={row.icon} label={row.label} description={row.description} />
                {trailing}
              </a>
            ) : (
              <Link key={row.href} href={row.href} className={ROW}>
                <RowBody icon={row.icon} label={row.label} description={row.description} />
                {trailing}
              </Link>
            )
          })}
        </PanelRows>
      </Panel>
    </ProfileSection>
  )
}

/** The mobile Help block: support, guides, the three policies, Instagram. */
export function useHelpRows(): SettingsRow[] {
  const { t } = useTranslation('profile')
  return [
    { kind: 'link', href: '/support', icon: HelpCircle, label: t('dashboard.help.help_center') },
    { kind: 'link', href: '/resources', icon: BookOpen, label: t('dashboard.help.guides') },
    { kind: 'link', href: '/legal/terms', icon: FileText, label: t('dashboard.help.terms') },
    { kind: 'link', href: '/legal/privacy', icon: Shield, label: t('dashboard.help.privacy_policy') },
    { kind: 'link', href: '/legal/refunds', icon: RotateCcw, label: t('dashboard.help.refunds') },
    {
      kind: 'link',
      href: INSTAGRAM_URL,
      icon: Instagram,
      label: t('dashboard.help.instagram'),
      external: true,
      trailing: '@tikem.co',
    },
  ]
}
