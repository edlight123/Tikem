'use client'

/**
 * On an event page once it is over (the post-event loop): "How was it?" for
 * people who were checked in (one tap, /api/events/[id]/feedback, private to
 * the organizer), the photo gallery people who went add to (moderated: the
 * organizer side approves or removes each one here), and the organizer's next
 * event with Follow. Each part only shows when it has something to say.
 * Ported from Tikra (f832197a); the app twin is mobile/components/AfterEvent.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Check, Trash2 } from 'lucide-react'
import FollowButton from '@/components/FollowButton'
import { formatEventDateTime } from '@/lib/datetime/eventClock'

type Photo = { id: string; url: string; caption: string | null; user_name?: string }
type NextEvent = {
  id: string
  title: string
  start_datetime: string | null
  banner_image_url: string | null
  venue_name: string
  city: string
  country: string | null
  timezone: string | null
}
type Data = {
  photos: Photo[]
  pending: Photo[]
  canAdd: boolean
  isManager: boolean
  mine: number
  maxPerPerson?: number
  nextEvent: NextEvent | null
}

const heading = 'font-display lowercase italic !text-section !leading-snug text-fg'

export default function AfterEvent({
  eventId,
  organizerId,
  organizerName,
  userId,
  isFollowing,
  className = '',
}: {
  eventId: string
  /** Null on the organizer's own event (no "follow yourself"). */
  organizerId: string | null
  organizerName: string
  userId: string | null
  isFollowing: boolean
  className?: string
}) {
  const { t, i18n } = useTranslation('common')
  const [data, setData] = useState<Data | null>(null)
  const [canRate, setCanRate] = useState(false)
  const [rated, setRated] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = () =>
    fetch(`/api/events/${encodeURIComponent(eventId)}/photos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {})

  useEffect(() => {
    load()
    if (userId) {
      fetch(`/api/events/${encodeURIComponent(eventId)}/feedback`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return
          setCanRate(!!d.canRate)
          if (d.feedback?.rating) setRated(Number(d.feedback.rating))
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, userId])

  const rate = async (rating: number) => {
    setRated(rating)
    await fetch(`/api/events/${encodeURIComponent(eventId)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }).catch(() => {})
  }

  const addPhoto = async (f: File) => {
    setBusy(true)
    setNote('')
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/photos`, { method: 'POST', body: form })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNote(d.code === 'too_large' ? t('afterEvent.photoTooLarge') : t('afterEvent.photoFailed'))
        return
      }
      setNote(d.status === 'approved' ? '' : t('afterEvent.photoAdded'))
      load()
    } catch {
      setNote(t('afterEvent.photoFailed'))
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const review = async (photoId: string, status: 'approved' | 'rejected') => {
    await fetch(`/api/events/${encodeURIComponent(eventId)}/photos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, status }),
    }).catch(() => {})
    load()
  }

  const faces: Array<[number, string]> = [
    [1, t('afterEvent.faceMeh')],
    [2, t('afterEvent.faceGood')],
    [3, t('afterEvent.faceGreat')],
  ]
  const next = data?.nextEvent
  const max = data?.maxPerPerson ?? 6
  const nextDay = next?.start_datetime
    ? formatEventDateTime(next.start_datetime, next, i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })
    : ''
  const showPhotos = !!data && (data.photos.length > 0 || data.canAdd || data.pending.length > 0)
  const showNext = !!organizerId && (!!next || !isFollowing)
  if (!canRate && !showPhotos && !showNext) return null

  return (
    <div className={`space-y-8 ${className}`}>
      {canRate && (
        <section>
          <h2 className={heading}>{t('afterEvent.howWasIt')}</h2>
          <p className="mt-1 text-meta text-fg-muted">{rated ? t('afterEvent.thanks') : t('afterEvent.howWasItBody')}</p>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t('afterEvent.howWasIt')}>
            {faces.map(([n, label]) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rated === n}
                onClick={() => rate(n)}
                className={`h-10 rounded px-4 text-sm font-semibold transition-colors ${
                  rated === n ? 'bg-inverse text-on-inverse' : 'bg-surface-raised text-fg hover:bg-surface-high'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {showPhotos && data && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={heading}>{t('afterEvent.photosTitle')}</h2>
            {data.canAdd && data.mine < max && (
              <>
                <input
                  ref={file}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => file.current?.click()}
                  className="inline-flex h-10 items-center gap-2 rounded bg-surface-raised px-3.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-high disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {busy ? t('afterEvent.uploading') : t('afterEvent.addPhotos')}
                </button>
              </>
            )}
          </div>
          {note && (
            <p className="mb-3 text-meta text-fg-muted" role="status">
              {note}
            </p>
          )}
          {data.photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {data.photos.map((p) => (
                <li key={p.id} className="aspect-square overflow-hidden rounded bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || ''} loading="lazy" className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
          )}
          {data.isManager && data.pending.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold text-fg">
                {t('afterEvent.pendingTitle')} · {data.pending.length}
              </p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {data.pending.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                    {p.user_name ? <p className="truncate px-2 pt-1.5 text-caption text-fg-subtle">{p.user_name}</p> : null}
                    <div className="flex gap-1 p-2">
                      <button
                        type="button"
                        onClick={() => review(p.id, 'approved')}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded bg-inverse text-caption font-semibold text-on-inverse"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden /> {t('afterEvent.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => review(p.id, 'rejected')}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded bg-surface-raised text-caption font-semibold text-fg hover:bg-surface-high"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> {t('afterEvent.remove')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {showNext && organizerId && (
        <section>
          <h2 className={heading}>
            {organizerName ? t('afterEvent.nextFrom', { name: organizerName }) : t('afterEvent.nextFromThem')}
          </h2>
          {next ? (
            <Link href={`/events/${next.id}`} className="mt-3 flex items-center gap-3 rounded transition-opacity hover:opacity-80">
              {next.banner_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={next.banner_image_url} alt="" className="h-16 w-[52px] flex-none rounded object-cover" />
              ) : (
                <span className="h-16 w-[52px] flex-none rounded bg-surface-raised" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="block truncate text-body font-semibold text-fg">{next.title}</span>
                <span className="block truncate text-meta text-fg-muted" suppressHydrationWarning>
                  {[nextDay, next.venue_name || next.city].filter(Boolean).join(' · ')}
                </span>
              </span>
            </Link>
          ) : null}
          {!isFollowing && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-meta text-fg-muted">{t('afterEvent.followPrompt')}</p>
              <FollowButton organizerId={organizerId} userId={userId} initialIsFollowing={isFollowing} />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
