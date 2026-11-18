'use client'

/**
 * "View" on the guestlist card, the web twin of mobile/components/GuestlistSheet.
 *
 *  - gate: the viewer shows no photo. Show your face to see theirs: the faces
 *    going sit blurred behind the viewer's own empty portrait, and "Add a
 *    photo" uploads right here (/api/profile/upload-photo) and turns the sheet
 *    into the list without leaving the event.
 *  - list: friends first, the viewer on top, and one quiet line for everyone
 *    who keeps it private. The server enforces the gate too (?full=1 answers
 *    `needsPhoto` to a viewer without a photo).
 *
 * A bottom sheet on a phone; BottomSheet centres it as a dialog on desktop.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Camera, Loader2 } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import type { PublicUserSummary } from '@/types/social'
import { defaultAvatarAt, defaultAvatarIndex, defaultAvatarUrl } from '@/lib/defaultAvatar'

interface Props {
  open: boolean
  onClose: () => void
  eventId: string
  viewerId: string
  viewerName?: string | null
  viewerPhotoUrl?: string | null
  /** Faces already on the card: the blurred crowd behind the gate. */
  previewFaces: PublicUserSummary[]
  totalGoing: number
  showCount: boolean
}

// An account with no name comes back as "Tikèm user"; a column of those reads
// as filler, so they count with the private rest instead.
const named = (u: PublicUserSummary) => !!u.displayName?.trim() && u.displayName !== 'Tikèm user'

export default function GuestlistSheet({
  open,
  onClose,
  eventId,
  viewerId,
  viewerName,
  viewerPhotoUrl,
  previewFaces,
  totalGoing,
  showCount,
}: Props) {
  const { t } = useTranslation('common')
  const [photo, setPhoto] = useState<string | null>(viewerPhotoUrl || null)
  const [mode, setMode] = useState<'gate' | 'list'>(viewerPhotoUrl ? 'list' : 'gate')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState<{
    friends: PublicUserSummary[]
    others: PublicUserSummary[]
    viewerIsGoing: boolean
    total: number
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setMode(photo ? 'list' : 'gate')
  }, [open, photo])

  useEffect(() => {
    if (!open || mode !== 'list') return
    let live = true
    setList(null)
    fetch(`/api/events/${eventId}/social?full=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return
        if (d.needsPhoto) return setMode('gate')
        setList({
          friends: (d.friendsGoing || []).filter(named),
          others: (d.publicGoing || []).filter(named),
          viewerIsGoing: !!d.viewerIsGoing,
          total: Number(d.totalGoing) || 0,
        })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [open, mode, eventId])

  const upload = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/profile/upload-photo', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.photo_url) throw new Error(json.error || 'upload')
      setPhoto(json.photo_url)
      setMode('list')
    } catch (e: any) {
      setError(e?.message && e.message !== 'upload' ? e.message : t('profile.photo_upload_failed', 'Upload failed. Try again.'))
    } finally {
      setUploading(false)
    }
  }

  const base = defaultAvatarIndex(eventId)
  const crowd = previewFaces
    .slice(0, 4)
    .map((u) => u.photoURL || defaultAvatarUrl(String(u.uid)))
  while (crowd.length < 4) crowd.push(defaultAvatarAt(base + crowd.length * 5))

  const shown = list ? list.friends.length + list.others.length + (list.viewerIsGoing ? 1 : 0) : 0
  const hidden = list ? Math.max(0, list.total - shown) : 0

  return (
    <BottomSheet isOpen={open} onClose={onClose}>
      {mode === 'gate' ? (
        <div className="flex flex-col items-center pb-2 pt-2 text-center">
          {/* The stage: the crowd stepped back and blurred, the viewer in front. */}
          <div className="relative flex h-32 w-full items-center justify-center">
            {crowd.map((src, i) => {
              const left = i < 2
              const near = i % 2 === 0
              const offset = near ? 'calc(50% + 34px)' : 'calc(50% + 86px)'
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  aria-hidden
                  className={`absolute rounded-full object-cover blur-[2px] ${near ? 'h-16 w-16 opacity-80' : 'h-12 w-12 opacity-45'}`}
                  style={left ? { right: offset } : { left: offset }}
                />
              )
            })}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative h-28 w-28 rounded-full"
              aria-label={t('whos_going.add_photo', 'Add a photo')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={defaultAvatarUrl(viewerId)}
                alt=""
                className="h-28 w-28 rounded-full border-[3px] border-surface-solid object-cover"
              />
              <span className="absolute bottom-1 right-0.5 grid h-9 w-9 place-items-center rounded-full border-[3px] border-surface-solid bg-inverse">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin text-on-inverse" /> : <Camera className="h-4 w-4 text-on-inverse" />}
              </span>
            </button>
          </div>

          <h2 className="mt-5 font-display !text-display italic !leading-tight text-fg">
            {t('whos_going.gate_title', "see who's going")}
          </h2>
          <p className="mt-1 text-body text-fg-muted">{t('whos_going.gate_sub', 'Show your face to see theirs.')}</p>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-7 flex h-[52px] w-full items-center justify-center rounded bg-inverse text-body font-bold text-on-inverse transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : t('whos_going.add_photo', 'Add a photo')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-1 py-3.5 text-body font-semibold text-fg-muted transition-colors hover:text-fg"
          >
            {t('whos_going.not_now', 'Not now')}
          </button>
        </div>
      ) : (
        <div className="pb-2">
          <h2 className="font-display !text-display italic !leading-tight text-fg">
            {t('whos_going.list_title', 'guestlist')}
          </h2>
          {showCount && (
            <p className="text-meta text-fg-muted">
              {t('whos_going.going_count', { count: totalGoing, defaultValue: '{{count}} going' })}
            </p>
          )}

          {!list ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-fg-subtle" />
            </div>
          ) : (
            <ul className="mt-4 max-h-[60vh] overflow-y-auto">
              {list.viewerIsGoing && (
                <li className="flex items-center gap-3.5 py-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo || defaultAvatarUrl(viewerId)} alt="" className="h-[52px] w-[52px] rounded-full object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-fg">
                      {viewerName || t('whos_going.you_badge', 'You')}
                    </p>
                    <p className="text-meta text-fg-subtle">{t('whos_going.you_badge', 'You')}</p>
                  </div>
                </li>
              )}
              {[...list.friends.map((u) => ({ u, friend: true })), ...list.others.map((u) => ({ u, friend: false }))].map(
                ({ u, friend }) => (
                  <li key={u.uid}>
                    <Link
                      href={`/profile/organizer/${u.uid}`}
                      className="-mx-2 flex items-center gap-3.5 rounded px-2 py-2.5 transition-colors hover:bg-surface"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u.photoURL || defaultAvatarUrl(String(u.uid))}
                        alt=""
                        className="h-[52px] w-[52px] rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-fg">{u.displayName}</p>
                        {friend && <p className="text-meta text-fg-subtle">{t('whos_going.friend', 'Friend')}</p>}
                      </div>
                    </Link>
                  </li>
                ),
              )}
              {hidden > 0 && (
                <li className="flex items-center gap-3.5 py-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={defaultAvatarAt(base)} alt="" className="h-[52px] w-[52px] rounded-full opacity-60" />
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-fg-soft">
                      {showCount
                        ? t('whos_going.more_guests', { count: hidden, defaultValue: '+{{count}} more' })
                        : t('whos_going.more_private', 'Others keep it private')}
                    </p>
                    {showCount && (
                      <p className="text-meta text-fg-subtle">{t('whos_going.more_private', 'Others keep it private')}</p>
                    )}
                  </div>
                </li>
              )}
              {shown === 0 && hidden === 0 && (
                <li className="py-4 text-meta text-fg-subtle">{t('whos_going.no_faces', 'No one shows their face yet.')}</li>
              )}
            </ul>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
