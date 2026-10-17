'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import {
  FLYER_LIBRARY,
  flyerLibraryFullUrl,
  flyerLibraryThumbUrl,
  type FlyerLibraryItem,
} from '@/lib/flyerLibrary'

/**
 * Pick a flyer instead of uploading one.
 *
 * Selecting a tile hands the parent a finished image URL — there is no upload
 * step, because these already live on a CDN the app allows. That is the whole
 * point: an organizer with no poster gets one in a single click, and a signed
 * out visitor on /create gets one without an account.
 */
/** Case and diacritics, so "fete" reaches "fèt" and "kreyol" reaches "kreyòl". */
const fold = (v: string) =>
  (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

export default function FlyerLibraryPicker({
  current,
  onPick,
  onClose,
}: {
  current?: string | null
  onPick: (url: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('common')
  const [q, setQ] = useState('')

  // A placeholder that clips is worse than a short one. At a 402px viewport the
  // input has ~302px of room — ~260px once the clear button appears — while the
  // long placeholder measures ~297px in Inter 15 in English and ~309px in
  // French. So the phone gets the short form and the desktop keeps the
  // examples. Starts false so the server and the first client render agree.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  /**
   * Ranked, not filtered — matches lead, everything else follows.
   *
   * This used to be a hard `.filter`, so a specific query ("konpa", "gala")
   * left two or three tiles in a grid built for fifteen and the picker looked
   * broken: "when i search, it should maybe show more options then the few
   * that is displayed". Nobody searching a library of artwork wants LESS
   * artwork — they want the likely ones first. So matches sort to the front
   * and the rest stay available underneath, with `matchCount` telling the
   * caller where to draw the divider.
   *
   * Accents are folded because the tags an organizer types are Kreyòl and
   * French — "fete" has to reach "fèt", and nobody types the grave on a phone.
   */
  const { items, matchCount } = useMemo(() => {
    const needle = fold(q)
    if (!needle) return { items: [...FLYER_LIBRARY], matchCount: 0 }
    const hits: FlyerLibraryItem[] = []
    const rest: FlyerLibraryItem[] = []
    for (const i of FLYER_LIBRARY) {
      const hay = fold([i.label, i.id, ...i.tags].join(' '))
      ;(hay.includes(needle) ? hits : rest).push(i)
    }
    return { items: [...hits, ...rest], matchCount: hits.length }
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const labelFor = (item: FlyerLibraryItem) =>
    t(`composer.flyerLib.${item.id}`, { defaultValue: item.label })

  /**
   * Portalled to <body>, and full-height rather than tucked under the chrome.
   *
   * Two rounds of this bug. First the sheet was capped at `90vh`, and on iOS
   * `vh` excludes the browser chrome — so it overshot the visible area and its
   * header went up behind the navbar. The fix for that reserved the navbar
   * with `pt-[var(--chrome-h)]`, and that was still wrong, because the
   * composer has a SECOND piece of sticky chrome: the four-quarter progress
   * bar, measured at 57->85px. Reserving only the navbar left the sheet's top
   * edge at 80 and its header tucked under the bar again.
   *
   * Reserving both would be a third number to keep in sync. A modal is allowed
   * to cover the chrome — that is what BottomSheet does — so this one does
   * too: no top padding, `100svh` for the cap, and the header lands at the top
   * of the screen with nothing above it to hide behind.
   *
   * The portal is the other half. This was the last `fixed inset-0` overlay in
   * the app still rendered in place, and `inset-0` only means the viewport
   * while no ancestor creates a containing block. Nothing traps it today, but
   * the composer grows transforms and blurs regularly, and this exact failure
   * has already been fixed three times elsewhere (BottomSheet, PickerModal,
   * DateChips).
   */
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close', { defaultValue: 'Close' })}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('composer.flyerLibrary', { defaultValue: 'Flyer library' })}
        /* Height capped against svh MINUS the navbar, not 90vh.
           On iOS `100vh` is the viewport WITHOUT the browser chrome, so it is
           larger than what you can actually see — 90vh on a 660px-visible
           screen resolves to ~660px, the bottom-anchored sheet's top edge goes
           above y=56, and the header ("Free artwork you can use as-is…")
           renders underneath the navbar. `svh` is the small viewport height,
           which is the honest number, and --chrome-h is the navbar's own
           height (globals.css). Same class of bug as the homepage phone
           mockup. */
        className="relative flex max-h-[calc(100svh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-[#1c1c1c] shadow-2xl sm:max-h-[85svh] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              {t('composer.flyerLibrary', { defaultValue: 'Flyer library' })}
            </h2>
            {/* Two spans rather than one string: the long sentence takes three
                lines at 402px and pushes the grid down the sheet. */}
            <p className="mt-0.5 text-xs text-white/50">
              <span className="sm:hidden">
                {t('composer.flyerLibraryHintShort', {
                  defaultValue: 'Free artwork. Swap it any time.',
                })}
              </span>
              <span className="hidden sm:inline">
                {t('composer.flyerLibraryHint', {
                  defaultValue: 'Free artwork you can use as-is. Swap it for your own flyer any time.',
                })}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search. Fifteen tiles fit on a laptop but not on a phone, and an
            organizer usually knows the kind of night before the picture. */}
        <div className="shrink-0 px-5 pt-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-4">
            <Search className="h-[18px] w-[18px] shrink-0 text-white/40" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                wide
                  ? t('composer.flyerSearchPlaceholder', {
                      defaultValue: 'Search artwork: konpa, party, gala, sports…',
                    })
                  : t('composer.flyerSearchShort', { defaultValue: 'Search: konpa, gala…' })
              }
              aria-label={t('composer.flyerSearchPlaceholder', { defaultValue: 'Search artwork' })}
              className="min-h-11 w-full bg-transparent py-3 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label={t('common.clear', { defaultValue: 'Clear' })}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/40 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Why `auto-rows-min` matters more than the tile's aspect class: this
            grid is a flex child with `flex-1`, so it gets a DEFINITE height
            from the sheet's max-h-[90vh]. With the default `auto` rows, Blink
            divides that height among the eight rows instead of letting them
            overflow — at a 402px phone the rows came out 57px tall, so each
            tile was a 223x57 band that clipped its own 4:5 image. Sizing the
            rows to their content is what makes the tiles posters AND what
            gives the grid something to scroll: before this the grid's
            scrollHeight always equalled its clientHeight.
            The sheet is its own fixed overlay with `document.body` locked, so
            this grid is the only scroll container — no nested scroll to trap
            anyone, and its sensible max height is the sheet's own 90vh. */}
        {/* scrollbar-hide: it still scrolls, the bar just isn't drawn (owner
            ask). The utility lives in globals.css and covers WebKit, Firefox
            and old Edge — the grid is a touch surface first, and on a phone the
            bar only ever appeared as a grey stripe over the right column of
            posters. */}
        <div className="scrollbar-hide grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-3 overflow-y-auto overscroll-contain p-5 sm:grid-cols-3">
          {/* The grid is never empty now, so "no artwork matches" would be a
              lie — a query with no hits just shows the whole library under
              this line instead. */}
          {q.trim() !== '' && matchCount === 0 && (
            <p className="col-span-full pb-1 text-sm text-white/45">
              {t('composer.flyerNoMatchAll', {
                defaultValue: 'Nothing matched that. Here is everything.',
              })}
            </p>
          )}
          {items.map((item, i) => {
            const full = flyerLibraryFullUrl(item)
            const selected = current === full
            // Where the matches stop and the rest of the library begins.
            const startsRest = matchCount > 0 && i === matchCount
            return (
              // The poster frame is the tile itself, not the picture inside it:
              // the button is the box that clips, so the box is what has to be
              // 4:5. `self-start` keeps a row from ever stretching it.
              <Fragment key={item.id}>
              {startsRest && (
                <p className="label-mono col-span-full pt-2 text-[10px] uppercase tracking-wider text-white/35">
                  {t('composer.flyerMore', { defaultValue: 'More artwork' })}
                </p>
              )}
              <button
                type="button"
                onClick={() => onPick(full)}
                aria-pressed={selected}
                title={labelFor(item)}
                className={`group relative aspect-[4/5] self-start overflow-hidden rounded-xl border text-left transition-colors ${
                  selected ? 'border-white' : 'border-white/10 hover:border-white/35'
                }`}
              >
                {/* Plain img, not next/image: fifteen tiles through the
                    optimizer is fifteen server fetches for images the CDN
                    already serves at exactly this size. h-full rather than an
                    aspect class of its own — if aspect-ratio on a form control
                    ever fails us, height:auto against a shrink-wrapped button
                    still lands on the thumb's own 4:5. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={flyerLibraryThumbUrl(item)}
                  alt={labelFor(item)}
                  loading="lazy"
                  // 55 thumbs are 1.73MB in total; lazy means only the visible
                  // ~6 are paid for on open, and `async` keeps decoding off the
                  // main thread as the rest scroll in.
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {/* One line, always. The band is absolute so a wrapped label
                    never changed the tile's height — it ate a second line of
                    the poster on some tiles and not others, which is what made
                    the row of captions look ragged. `title` keeps the full
                    text reachable. */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6 text-[11px] font-semibold leading-4 text-white">
                  {labelFor(item)}
                </span>
                {selected && (
                  <span className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white">
                    <Check className="h-3.5 w-3.5 text-black" />
                  </span>
                )}
              </button>
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
