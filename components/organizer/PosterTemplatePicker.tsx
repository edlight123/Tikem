'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, X } from 'lucide-react'
import { flyerLibraryFullUrl, flyerLibraryThumbUrl, seasonalFlyerLibrary } from '@/lib/flyerLibrary'
import { TEMPLATES, defaultPalette, type PhotoTreatment } from '@/lib/posters/templates'
import { holidayPhotoUrl, holidayPosterSpec, holidayTemplatesFor, type HolidayTemplate } from '@/lib/holidayTemplates'
import { occasionName, type OccasionKey } from '@/lib/occasions'

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
 *
 * When the event belongs to an occasion (tagged, or its date falls in one),
 * that occasion's holiday templates (lib/holidayTemplates: a real photo, a
 * layout and a colourway chosen together) come first, as a "For Nwèl" row,
 * drawn with the event's own title and date.
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
  /** The event's country: 'HT' prints the flyer's time as "8:00 PM" in French too. */
  country?: string
}

/** What was chosen, so the composer can redraw it when the facts change. */
export interface PosterSpec {
  template: string
  palette: number
  photo: string | null
  /** The photo treatment, when it isn't the layout's own (holiday templates). */
  treatment?: PhotoTreatment
  /** The holiday template it came from (lib/holidayTemplates id). */
  holiday?: string
}

/** Draws `spec` with `facts` full size and stores it; resolves to the image URL. */
export async function makePoster(facts: PosterFacts, spec: PosterSpec, locale: string): Promise<string> {
  const q = query(facts, spec.template, spec.palette, spec.photo, locale, spec.treatment)
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

export function query(facts: PosterFacts, template: string, palette: number, photo: string | null, locale: string, treatment?: PhotoTreatment) {
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
  if (facts.country) q.set('country', facts.country)
  if (photo) q.set('photo', photo)
  if (treatment) q.set('treatment', treatment)
  return q
}

/** A holiday template's live preview with this event's facts (the picker tile, the composer's first poster). */
export function holidayPreviewSrc(facts: PosterFacts, t: HolidayTemplate, locale: string): string {
  return `/api/posters/preview?${query(facts, t.layout, t.palette, holidayPhotoUrl(t), locale, t.treatment)}`
}

export default function PosterTemplatePicker({
  facts,
  photo: initialPhoto,
  occasion,
  onPick,
  onClose,
}: {
  facts: PosterFacts
  /** The organizer's own photo, used as the default background. */
  photo?: string | null
  /** The occasion whose holiday templates lead (lib/occasions posterOccasion), or none. */
  occasion?: OccasionKey | null
  onPick: (url: string, spec: PosterSpec) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const locale = (i18n.language || 'ht').slice(0, 2)
  const photos = useMemo(() => {
    const lib = seasonalFlyerLibrary().slice(0, 10).map((f) => ({ full: flyerLibraryFullUrl(f), thumb: flyerLibraryThumbUrl(f) }))
    return initialPhoto ? [{ full: initialPhoto, thumb: initialPhoto }, ...lib] : lib
  }, [initialPhoto])
  const [photo, setPhoto] = useState<string>(photos[0]?.full || '')
  const holidays = useMemo(() => holidayTemplatesFor(occasion), [occasion])
  // A holiday template is selected as "holiday:<id>", a plain layout by its id.
  const [selected, setSelected] = useState<string>(() => (holidays[0] ? `holiday:${holidays[0].id}` : TEMPLATES[0].id))
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
    const holiday = selected.startsWith('holiday:') ? holidays.find((h) => `holiday:${h.id}` === selected) : null
    const tpl = TEMPLATES.find((x) => x.id === selected)
    if (!holiday && !tpl) return
    setSaving(true)
    setError('')
    try {
      const spec: PosterSpec = holiday
        ? holidayPosterSpec(holiday)
        : { template: selected, palette: paletteOf(selected), photo: tpl!.usesPhoto ? photo : null }
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
        className="absolute inset-0 bg-scrim-strong backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('composer.posterTemplates.title', { defaultValue: 'Make a poster' })}
        className="relative flex max-h-[calc(100svh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-surface-raised-solid shadow-2xl sm:max-h-[90svh] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-body font-semibold text-fg">
              {t('composer.posterTemplates.title', { defaultValue: 'Make a poster' })}
            </h2>
            <p className="mt-0.5 text-meta text-fg-subtle">
              {t('composer.posterTemplates.hint', {
                defaultValue: "Your event's details, designed. Pick a layout, then a colour.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-surface hover:text-fg"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The occasion's own posters first: photo, layout and colour chosen together. */}
        {occasion && holidays.length > 0 && (
          <div className="shrink-0 px-5 pb-4">
            <p className="text-caption font-medium uppercase tracking-wider text-fg-subtle">
              {t('composer.posterTemplates.forOccasion', {
                defaultValue: 'For {{name}}',
                name: occasionName(occasion, locale),
              })}
            </p>
            <div className="scrollbar-hide mt-2 flex gap-3 overflow-x-auto pb-1">
              {holidays.map((h) => {
                const on = selected === `holiday:${h.id}`
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelected(`holiday:${h.id}`)}
                    aria-pressed={on}
                    aria-label={h.title[locale === 'fr' || locale === 'ht' ? locale : 'en']}
                    className={`relative aspect-[4/5] w-28 shrink-0 overflow-hidden rounded bg-surface-low sm:w-32 ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-raised-solid' : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={holidayPreviewSrc(facts, h, locale)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {on && (
                      <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-inverse text-on-inverse">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Background photo for the layouts that use one. */}
        <div className="shrink-0 px-5">
          <p className="text-caption font-medium uppercase tracking-wider text-fg-subtle">
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
                className={`relative h-14 w-11 shrink-0 overflow-hidden rounded bg-surface ${photo === p.full ? 'ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
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
                  className={`relative block aspect-[4/5] w-full overflow-hidden rounded bg-surface-low ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-raised-solid' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {on && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-inverse text-on-inverse">
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

        <div className="flex shrink-0 items-center justify-between gap-3 bg-surface-raised-solid px-5 py-4">
          <p className="min-w-0 text-meta text-danger-soft">{error}</p>
          <button
            type="button"
            onClick={use}
            disabled={saving}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded bg-inverse px-5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-60"
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
