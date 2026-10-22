'use client'

import { useState } from 'react'
import { Calendar, MapPin, Globe, Edit, Share2, Eye } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/Toast'
import { StatusChip } from '@/components/ui/kit'

interface EventHeaderProps {
  event: {
    id: string
    title: string
    start_datetime: string
    end_datetime: string
    venue_name?: string
    city?: string
    is_online?: boolean
    is_published: boolean
    updated_at: string
  }
}

export function EventHeader({ event }: EventHeaderProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const { showToast } = useToast()
  const [isPublishing, setIsPublishing] = useState(false)

  const handlePublishToggle = async () => {
    setIsPublishing(true)
    try {
      const response = await fetch(`/api/events/${event.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: !event.is_published }),
      })
      const data = await response.json().catch(() => ({}))

      // A refused publish used to return here silently — the button just
      // stopped spinning. The route always says why (verification, Stripe
      // onboarding, a moderation hold…), so show that.
      if (!response.ok) {
        showToast({
          type: 'error',
          title: t('composer.toasts.errUpdateTitle', { defaultValue: 'Could not update' }),
          message:
            (typeof data?.error === 'string' && data.error) ||
            t('composer.toasts.publishStatusErr', { defaultValue: 'Could not update publish status' }),
          duration: 6000,
        })
        return
      }

      // Non-blocking advisories from the publish route (today: the event's
      // country differs from the connected Stripe account's country, so the
      // payout converts into that account's currency). A full page reload would
      // wipe the toast before it could be read, so refresh in place instead.
      const warnings: Array<{ message?: string }> = Array.isArray(data?.warnings) ? data.warnings : []

      if (warnings.length > 0) {
        for (const warning of warnings) {
          if (!warning?.message) continue
          showToast({
            type: 'warning',
            title: 'Heads up about your payout',
            message: warning.message,
            duration: 12000,
          })
        }
        router.refresh()
        return
      }

      window.location.reload()
    } catch {
      showToast({
        type: 'error',
        title: t('composer.toasts.errUpdateTitle', { defaultValue: 'Could not update' }),
        message: t('composer.toasts.tryAgain', { defaultValue: 'Please try again.' }),
        duration: 5000,
      })
    } finally {
      setIsPublishing(false)
    }
  }
  const startDate = new Date(event.start_datetime)
  const updatedDate = new Date(event.updated_at)

  // NOT sticky. It was `sticky top-0 z-30` while OrganizerTopNav is
  // `sticky top-0 z-40` — same offset, lower layer — so on scroll the event
  // title bar pinned *underneath* the nav and simply disappeared. Two stacked
  // sticky bars only work if the lower one knows the upper one's height, and
  // this header's varies with the title. The tabs below are the thing worth
  // pinning (they are navigation); a title and its actions can scroll away.
  return (
    <div className="bg-[#0a0a0a]/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Desktop Header */}
        <div className="hidden md:block py-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="font-display italic text-2xl font-bold text-white truncate">{event.title}</h1>
                <StatusChip tone={event.is_published ? 'success' : 'neutral'}>
                  {event.is_published ? t('organizer.published') : t('organizer.draft')}
                </StatusChip>
              </div>
              <div className="flex items-center gap-4 text-sm text-white/60">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  <span className="font-mono tabular-nums">{format(startDate, 'EEE, MMM d, yyyy • h:mm a')}</span>
                </div>
                {event.is_online ? (
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-4 h-4" />
                    <span>{t('organizer.online_event')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    <span>{event.venue_name || event.city || 'Location TBD'}</span>
                  </div>
                )}
                <span className="font-mono tabular-nums text-xs text-white/50">
                  {t('organizer.updated')} {formatDistanceToNow(updatedDate, { addSuffix: true })}
                </span>
              </div>
            </div>

            {/* Primary Actions */}
            <div className="flex items-center gap-2 ml-4">
              <Link
                href={`/organizer/events/${event.id}/edit`}
                className="inline-flex h-11 items-center gap-2 rounded bg-white/[0.07] px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
              >
                <Edit className="w-4 h-4" />
                {t('organizer.edit')}
              </Link>
              <Link
                href={`/events/${event.id}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded bg-white/[0.07] px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
              >
                <Eye className="w-4 h-4" />
                {t('organizer.preview')}
              </Link>
              <button
                onClick={() => {
                  if (window.navigator.share) {
                    window.navigator.share({
                      title: event.title,
                      url: `${window.location.origin}/events/${event.id}`
                    })
                  } else {
                    navigator.clipboard.writeText(`${window.location.origin}/events/${event.id}`)
                  }
                }}
                className="inline-flex h-11 items-center gap-2 rounded bg-white/[0.07] px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
              >
                <Share2 className="w-4 h-4" />
                {t('organizer.share')}
              </button>
              <button
                onClick={handlePublishToggle}
                disabled={isPublishing}
                className={`h-11 rounded px-4 text-sm font-semibold transition-colors ${
                  event.is_published
                    ? 'bg-white/[0.12] text-white hover:bg-white/[0.18]'
                    : 'bg-white text-black hover:bg-white/90'
                }`}
              >
                {isPublishing ? t('organizer.processing') : event.is_published ? t('organizer.unpublish') : t('organizer.publish')}
              </button>
              
              {/* The overflow ⋮ menu was removed on owner ask (2026-09-03).
                  All three of its items — Duplicate, Cancel event, Delete —
                  were `<button>`s with NO onClick: they opened, they looked
                  live, and every one of them did nothing. A control that
                  promises a destructive action and silently declines is worse
                  than an absent one, so the whole menu goes rather than being
                  disabled in place. The strings (`organizer.duplicate`,
                  `organizer.cancel_event`, `organizer.delete`) stay in the
                  locales for whoever implements them. Delete already exists
                  and works in the organizer's events list; cancel and
                  duplicate do not exist anywhere yet. */}
            </div>
          </div>
        </div>

        {/* Mobile Header */}
        <div className="md:hidden py-3">
          <div className="flex items-center gap-2 mb-2">
            <h1 className="font-display italic text-lg font-bold text-white truncate flex-1">{event.title}</h1>
            <StatusChip tone={event.is_published ? 'success' : 'neutral'}>
              {event.is_published ? t('organizer.published') : t('organizer.draft')}
            </StatusChip>
          </div>
          <div className="flex flex-col gap-1 text-xs text-white/60">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">{format(startDate, 'MMM d, yyyy • h:mm a')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {event.is_online ? <Globe className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
              <span>{event.is_online ? t('organizer.online_event') : (event.venue_name || event.city || 'Location TBD')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Action Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-white/10 px-4 py-3 z-40 safe-bottom">
        <div className="grid grid-cols-4 gap-2">
          <Link
            href={`/organizer/events/${event.id}/edit`}
            className="flex flex-col items-center gap-1 rounded p-2 transition-colors hover:bg-white/[0.06]"
          >
            <Edit className="w-5 h-5 text-white/70" />
            <span className="text-xs text-white/70">{t('organizer.edit')}</span>
          </Link>
          <Link
            href={`/events/${event.id}`}
            target="_blank"
            className="flex flex-col items-center gap-1 rounded p-2 transition-colors hover:bg-white/[0.06]"
          >
            <Eye className="w-5 h-5 text-white/70" />
            <span className="text-xs text-white/70">{t('organizer.preview')}</span>
          </Link>
          <button
            onClick={() => {
              if (window.navigator.share) {
                window.navigator.share({
                  title: event.title,
                  url: `${window.location.origin}/events/${event.id}`
                })
              }
            }}
            className="flex flex-col items-center gap-1 rounded p-2 transition-colors hover:bg-white/[0.06]"
          >
            <Share2 className="w-5 h-5 text-white/70" />
            <span className="text-xs text-white/70">{t('organizer.share')}</span>
          </button>
          <button
            onClick={handlePublishToggle}
            disabled={isPublishing}
            className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${
              event.is_published ? 'bg-white/[0.08]' : 'hover:bg-white/[0.06]'
            }`}
          >
            <div className={`h-5 w-5 rounded-full ${event.is_published ? 'bg-brand-400' : 'bg-white/30'}`} />
            <span className={`text-xs font-medium ${event.is_published ? 'text-brand-300' : 'text-white/70'}`}>
              {event.is_published ? t('organizer.live') : t('organizer.publish')}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
