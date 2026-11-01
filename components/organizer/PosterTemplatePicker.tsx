'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, X } from 'lucide-react'
import { FLYER_LIBRARY, flyerLibraryFullUrl, flyerLibraryThumbUrl } from '@/lib/flyerLibrary'
import { TEMPLATES, defaultPalette } from '@/lib/posters/templates'

/**
 * "Make a poster": the event's own facts set in a designed template.
 *
 * Each tile is a live preview drawn by /api/posters/preview with this event's
 * title, date, venue and lineup, so what the organizer picks is exactly what
 * the feed will show. Picking draws it full size (POST /api/posters/create)
 * and hands back an ordinary image URL for the event's poster.
 *
 * Every template has three colourways and starts on one picked from the
 * event, so two events on the same layout still look different.
 */

export interface PosterFacts {
  title: string
  /** "YYYY-MM-DD" and "HH:mm", the composer's own fields. */
  date: string
  time: string
  venue?: string
  city?: string
  lineup?: string[]
  presenter?: string
}

/** What was chosen, so the composer can redraw it when the facts change. */
export interface PosterSpec {
  template: string
  palette: number
  photo: string | null
}

/** Draws `spec` with `facts` full size and stores it; resolves to the image URL. */
export async function makePoster(facts: PosterFacts, spec: PosterSpec, locale: string): Promise<string> {
  const q = query(facts, spec.template, spec.palette, spec.photo, locale)
  const body: Record<string, unknown> = Object.fromEntries(q.entries())
  body.lineup = facts.lineup || []
  const res = await fetch('/api/posters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.url) throw new Error(json?.error || 'failed')
  return json.url as string
}

function query(facts: PosterFacts, template: string, palette: number, photo: string | null, locale: string) {
  const q = new URLSearchParams({
    template,
    palette: String(palette),
    title: facts.title,
    start: `${facts.date}T${facts.time || '20:00'}`,
    venue: facts.venue || '',
    city: facts.city || '',
    lineup: (facts.lineup || []).join('|'),
    presenter: facts.presenter || '',
    locale: ['ht', 'fr', 'en'].includes(locale) ? locale : 'ht',
  })
  if (photo) q.set('photo', photo)
  return q
}

export default function PosterTemplatePicker({
  facts,
  photo: initialPhoto,
  onPick,
  onClose,
}: {
  facts: PosterFacts
  /** The organizer's own photo, used as the default background. */
  photo?: string | null
  onPick: (url: string, spec: PosterSpec) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const locale = (i18n.language || 'ht').slice(0, 2)
  const photos = useMemo(() => {
    const lib = FLYER_LIBRARY.slice(0, 10).map((f) => ({ full: flyerLibraryFullUrl(f), thumb: flyerLibraryThumbUrl(f) }))
    return initialPhoto ? [{ full: initialPhoto, thumb: initialPhoto }, ...lib] : lib
  }, [initialPhoto])
  const [photo, setPhoto] = useState<string>(photos[0]?.full || '')
  const [selected, setSelected] = useState<string>(TEMPLATES[0].id)
  const seed = `${facts.title}|${facts.date}`
  const [palettes, setPalettes] = useState<Record<string, number>>({})
  const paletteOf = (id: string) => palettes[id] ?? defaultPalette(`${seed}|${id}`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  async function use() {
    const tpl = TEMPLATES.find((x) => x.id === selected)
    if (!tpl) return
    setSaving(true)
    setError('')
    try {
      const spec: PosterSpec = { template: selected, palette: paletteOf(selected), photo: tpl.usesPhoto ? photo : null }
      onPick(await makePoster(facts, spec, locale), spec)
    } catch {
      setError(t('composer.posterTemplates.failed', { defaultValue: 'Could not make the poster. Try again.' }))
    } finally {
      setSaving(false)
    }
  }

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
        aria-label={t('composer.posterTemplates.title', { defaultValue: 'Make a poster' })}
        className="relative flex max-h-[calc(100svh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-[#1c1c1c] shadow-2xl sm:max-h-[90svh] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              {t('composer.posterTemplates.title', { defaultValue: 'Make a poster' })}
            </h2>
            <p className="mt-0.5 text-[13px] text-white/50">
              {t('composer.posterTemplates.hint', {
                defaultValue: "Your event's details, designed. Pick a layout, then a colour.",
              })}
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

        {/* Background photo for the layouts that use one. */}
        <div className="shrink-0 px-5">
          <p className="text-[12px] font-medium uppercase tracking-wider text-white/45">
            {t('composer.posterTemplates.photo', { defaultValue: 'Photo' })}
          </p>
          <div className="scrollbar-hide mt-2 flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button
                key={p.full}
                type="button"
                onClick={() => setPhoto(p.full)}
                aria-pressed={photo === p.full}
                aria-label={i === 0 && initialPhoto ? t('composer.posterTemplates.yourPhoto', { defaultValue: 'Your photo' }) : undefined}
                className={`relative h-14 w-11 shrink-0 overflow-hidden rounded bg-white/[0.06] ${photo === p.full ? 'ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-hide grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-3 overflow-y-auto overscroll-contain p-5 sm:grid-cols-3">
          {TEMPLATES.map((tpl) => {
            const on = selected === tpl.id
            const pal = paletteOf(tpl.id)
            const src = `/api/posters/preview?${query(facts, tpl.id, pal, tpl.usesPhoto ? photo : null, locale)}`
            return (
              <div key={tpl.id} className="self-start">
                <button
                  type="button"
                  onClick={() => setSelected(tpl.id)}
                  aria-pressed={on}
                  className={`relative block aspect-[4/5] w-full overflow-hidden rounded bg-white/[0.04] ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1c1c1c]' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {on && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-black">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
                {/* Colourways: fill, not outline — the chosen swatch is the larger one. */}
                <div className="mt-2 flex items-center gap-1.5">
                  {tpl.palettes.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setSelected(tpl.id)
                        setPalettes((prev) => ({ ...prev, [tpl.id]: i }))
                      }}
                      aria-label={t('composer.posterTemplates.colour', { defaultValue: 'Colour {{n}}', n: i + 1 })}
                      aria-pressed={pal === i}
                      className={`rounded-full transition-all ${pal === i ? 'h-5 w-5' : 'h-3.5 w-3.5 opacity-60 hover:opacity-100'}`}
                      style={{ background: `linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%)` }}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#1c1c1c] px-5 py-4">
          <p className="min-w-0 text-[13px] text-red-300">{error}</p>
          <button
            type="button"
            onClick={use}
            disabled={saving}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded bg-white px-5 text-[14px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('composer.posterTemplates.use', { defaultValue: 'Use this poster' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
