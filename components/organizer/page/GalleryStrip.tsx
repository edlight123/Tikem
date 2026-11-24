'use client'

/**
 * An organization's photos on its public page (lib/gallery.ts): a sideways
 * strip of 4:3 photos; a click opens a full-screen viewer (arrows, swipe-free
 * keyboard: ← → Esc). Same strip as the app's mobile/components/GalleryStrip.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { GalleryPhoto } from '@/lib/gallery'

export default function GalleryStrip({ photos, orgName }: { photos: GalleryPhoto[]; orgName: string }) {
  const { t } = useTranslation('profile')
  const [open, setOpen] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const count = photos.length
  const step = useCallback(
    (d: number) => setOpen((i) => (i == null ? i : (i + d + count) % count)),
    [count]
  )

  useEffect(() => {
    if (open == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, step])

  if (!count) return null
  const current = open != null ? photos[open] : null

  return (
    <>
      <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none]">
        {photos.map((p, i) => (
          <li key={p.url} className="shrink-0 snap-start">
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group block w-[220px] overflow-hidden rounded bg-surface outline-none focus-visible:ring-2 focus-visible:ring-fg/70 sm:w-[260px]"
              aria-label={p.caption || t('org_page.photo_of', { n: i + 1, total: count, name: orgName })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition-opacity group-hover:opacity-90"
              />
            </button>
            {p.caption && <p className="mt-1.5 w-[220px] truncate text-meta text-fg-subtle sm:w-[260px]">{p.caption}</p>}
          </li>
        ))}
      </ul>

      {mounted &&
        current &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('org_page.photos')}
            className="fixed inset-0 z-[80] flex flex-col bg-shade/95"
            onClick={() => setOpen(null)}
          >
            <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <span className="text-meta tabular-nums text-fg-muted" aria-live="polite">
                {(open ?? 0) + 1} / {count}
              </span>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-surface-raised text-fg hover:bg-surface-high"
                aria-label={t('org_page.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={current.caption || ''}
                className="max-h-full max-w-full rounded object-contain"
                onClick={(e) => e.stopPropagation()}
              />
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      step(-1)
                    }}
                    className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-surface-raised text-fg hover:bg-surface-high"
                    aria-label={t('org_page.previous')}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      step(1)
                    }}
                    className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-surface-raised text-fg hover:bg-surface-high"
                    aria-label={t('org_page.next')}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
            {current.caption && (
              <p className="px-6 pb-8 text-center text-body text-fg-soft" onClick={(e) => e.stopPropagation()}>
                {current.caption}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
