'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Loader2, UserPlus } from 'lucide-react'
import OrganizerMark from '@/components/OrganizerMark'
import { EmptyState } from '@/components/ui/kit'
import { useToast } from '@/components/ui/Toast'
import { FOLLOWING_PAGE_SIZE, type FollowedOrganizer, type FollowingPage } from '@/lib/profile/following'
import { GHOST_BTN, Panel, PanelRows, ProfileSection } from './ui'

/**
 * "Following": the organizers the reader follows, the web twin of the mobile
 * SubscriptionsScreen. Opened from the Following stat (/profile#following).
 *
 * Each row is the organizer's mark, name and verified tick, linking to their
 * public profile, with an Unfollow on the right. Unfollowing keeps the row in
 * place, dimmed, with a Follow button: that is the undo, and it keeps the
 * offset of the next page honest. Pages of FOLLOWING_PAGE_SIZE, "Show more"
 * for the rest.
 *
 * Followers (who follows you) has no list on purpose; it stays a count.
 */
export function FollowingCard({ onCountChange }: { onCountChange?: (delta: number) => void }) {
  const { t } = useTranslation('profile')
  const { showToast } = useToast()
  const [items, setItems] = useState<FollowedOrganizer[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  // Organizer ids unfollowed in this visit, and ids with a request in flight.
  const [unfollowed, setUnfollowed] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())

  const fetchPage = useCallback(async (offset: number): Promise<FollowingPage> => {
    const res = await fetch(`/api/profile/following?offset=${offset}&limit=${FOLLOWING_PAGE_SIZE}`, {
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`following ${res.status}`)
    return res.json()
  }, [])

  const loadFirst = useCallback(async () => {
    setStatus('loading')
    try {
      const page = await fetchPage(0)
      setItems(page.items)
      setNextOffset(page.nextOffset)
      setStatus('ready')
    } catch (err) {
      console.error('Failed to load following:', err)
      setStatus('error')
    }
  }, [fetchPage])

  useEffect(() => {
    loadFirst()
  }, [loadFirst])

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(nextOffset)
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))]
      })
      setNextOffset(page.nextOffset)
    } catch (err) {
      console.error('Failed to load more following:', err)
      showToast({ type: 'error', title: t('dashboard.following.load_error') })
    } finally {
      setLoadingMore(false)
    }
  }

  const setFlag = (setter: typeof setPending, id: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const toggle = async (org: FollowedOrganizer) => {
    if (pending.has(org.id)) return
    const isUnfollowing = !unfollowed.has(org.id)
    setFlag(setPending, org.id, true)
    try {
      const res = await fetch('/api/organizers/follow', {
        // DELETE only ever unfollows; POST (toggle) is safe here because the
        // row is known to be unfollowed when we follow again.
        method: isUnfollowing ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerId: org.id }),
      })
      if (!res.ok) throw new Error(`follow ${res.status}`)
      const { isFollowing } = await res.json()
      setFlag(setUnfollowed, org.id, !isFollowing)
      onCountChange?.(isUnfollowing ? -1 : 1)
      if (!isFollowing) {
        showToast({ type: 'success', title: t('dashboard.following.unfollowed', { name: org.name || t('dashboard.following.unknown') }) })
      }
    } catch (err) {
      console.error('Failed to update follow:', err)
      showToast({ type: 'error', title: t('dashboard.following.update_error') })
    } finally {
      setFlag(setPending, org.id, false)
    }
  }

  return (
    <ProfileSection title={t('dashboard.following.title')} description={t('dashboard.following.subtitle')}>
      {status === 'loading' ? (
        <Panel>
          <PanelRows>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                <div className="skeleton h-11 w-11 shrink-0 rounded" />
                <div className="skeleton h-4 w-40 rounded" />
              </div>
            ))}
          </PanelRows>
        </Panel>
      ) : status === 'error' ? (
        <EmptyState
          title={t('dashboard.following.load_error')}
          className="!p-8"
          action={
            <button type="button" onClick={loadFirst} className={GHOST_BTN}>
              {t('dashboard.following.retry')}
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title={t('dashboard.following.empty_title')}
          description={t('dashboard.following.empty_body')}
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
      ) : (
        <>
          <Panel>
            <PanelRows>
              {items.map((org) => {
                const off = unfollowed.has(org.id)
                const busy = pending.has(org.id)
                const name = org.name || t('dashboard.following.unknown')
                return (
                  <div key={org.id} className="flex items-center gap-3 px-4 py-3 sm:gap-3.5 sm:px-5">
                    <Link
                      href={`/profile/organizer/${org.id}`}
                      className={`group flex min-w-0 flex-1 items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:gap-3.5 ${off ? 'opacity-50' : ''}`}
                    >
                      <OrganizerMark logoUrl={org.avatar} className="h-11 w-11 rounded" />
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-display !text-[18px] !leading-snug text-white group-hover:text-white/80">
                          {name}
                        </span>
                        {org.isVerified ? (
                          <BadgeCheck className="h-4 w-4 shrink-0 text-brand-400" aria-label={t('organizer_profile.verified')} />
                        ) : null}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggle(org)}
                      disabled={busy}
                      aria-label={
                        off
                          ? t('dashboard.following.follow_name', { name })
                          : t('dashboard.following.unfollow_name', { name })
                      }
                      className={`${GHOST_BTN} shrink-0 justify-center sm:min-w-[96px] ${off ? '!bg-white !text-black hover:!bg-white/90' : ''}`}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                      {off ? t('dashboard.following.follow') : t('dashboard.following.unfollow')}
                    </button>
                  </div>
                )
              })}
            </PanelRows>
          </Panel>
          {nextOffset !== null ? (
            <div className="mt-4 flex justify-center">
              <button type="button" onClick={loadMore} disabled={loadingMore} className={GHOST_BTN}>
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {t('dashboard.following.show_more')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </ProfileSection>
  )
}
