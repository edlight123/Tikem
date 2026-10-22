'use client'

/**
 * The /discover search field with its autosuggest.
 *
 * Interaction model is lifted wholesale from components/home/HeroSearch.tsx —
 * 150ms debounce, a flat keyboard list (↑/↓/Enter/Escape), role="listbox" with
 * aria-activedescendant, click-outside close — so the two search fields on the
 * site behave identically. The difference is the data: HeroSearch filters an
 * array it was handed, this one QUERIES /api/discover/suggest, because it also
 * covers organizers, friends and cities.
 *
 * Rows are grouped for the eye (a quiet label per section) but flat for the
 * keyboard: ↑/↓ cross section boundaries without ceremony.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { format, isValid } from 'date-fns'
import { ArrowUpRight, BadgeCheck, MapPin, Search, User, Users } from 'lucide-react'

/** ~8 rows total; the per-section caps live server-side so events keep the top slots. */
interface SuggestResponse {
  events?: Array<{ id: string; title: string; image: string | null; city: string; date: string }>
  organizers?: Array<{ uid: string; name: string; photo: string | null; verified: boolean }>
  people?: Array<{
    uid: string
    name: string
    photo: string | null
    verified: boolean
    connected?: boolean
  }>
  cities?: string[]
}

type Row =
  | { kind: 'event'; key: string; id: string; title: string; image: string | null; meta: string }
  | {
      kind: 'organizer' | 'person'
      key: string
      uid: string
      name: string
      photo: string | null
      verified: boolean
      connected?: boolean
    }
  | { kind: 'city'; key: string; city: string }

interface Section {
  id: string
  label: string
  rows: Row[]
}

/**
 * next/image only accepts the hosts declared in next.config.js
 * (images.remotePatterns), and CSP img-src is enforcing in production. Anything
 * outside that list falls back to the gradient tile rather than rendering a
 * broken frame — we never add a host here without adding it to both.
 */
const ALLOWED_IMAGE_HOSTS = new Set([
  'images.unsplash.com',
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
])

function isRenderableImage(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return ALLOWED_IMAGE_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Compact date used inside suggestion rows; safe against invalid dates. */
function formatRowDate(date: string | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  return isValid(d) ? format(d, 'MMM d') : ''
}

export interface SearchSuggestProps {
  /** Current `?search=` value, so the field survives a navigation. */
  initialQuery?: string
  /** Drives which cities the tail section can offer. */
  userCountry?: string
  /** Plain Enter with nothing highlighted — the existing search-all behaviour. */
  onSubmit: (query: string) => void
  /** The field was emptied — existing behaviour drops `?search=`. */
  onClear?: () => void
  /** A city row was chosen — applies `?city=` instead of navigating. */
  onCitySelect: (city: string) => void
}

export function SearchSuggest({
  initialQuery = '',
  userCountry = 'HT',
  onSubmit,
  onClear,
  onCitySelect,
}: SearchSuggestProps) {
  const { t } = useTranslation('common')
  const router = useRouter()

  const [query, setQuery] = useState(initialQuery)
  const [data, setData] = useState<SuggestResponse>({})
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  /** Only true once a request has been pending ~250ms — fast responses never flicker. */
  const [showLoading, setShowLoading] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listboxId = useId()

  // ---- Debounced query → API, with the in-flight request abandoned on change.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      abortRef.current?.abort()
      setData({})
      setShowLoading(false)
      return
    }

    let slowTimer: ReturnType<typeof setTimeout> | null = null

    const debounce = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Subtle loading state only if the answer is actually slow.
      slowTimer = setTimeout(() => setShowLoading(true), 250)

      fetch(
        `/api/discover/suggest?q=${encodeURIComponent(q)}&country=${encodeURIComponent(userCountry)}`,
        { signal: controller.signal, cache: 'no-store' }
      )
        .then((res) => (res.ok ? res.json() : {}))
        .then((json: SuggestResponse) => {
          if (controller.signal.aborted) return
          setData(json || {})
          setOpen(true)
          setHighlight(-1)
        })
        .catch(() => {
          // Aborted or failed — the plain-Enter path still works.
          if (!controller.signal.aborted) setData({})
        })
        .finally(() => {
          if (slowTimer) clearTimeout(slowTimer)
          if (!controller.signal.aborted) setShowLoading(false)
        })
    }, 150)

    return () => {
      clearTimeout(debounce)
      if (slowTimer) clearTimeout(slowTimer)
    }
  }, [query, userCountry])

  useEffect(() => () => abortRef.current?.abort(), [])

  // ---- Click outside closes, same as HeroSearch's delayed blur but without the
  // race: a real outside-pointer check, so row clicks are never swallowed.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  // ---- Grouped for the eye, flat for the keyboard. Empty groups omit their label.
  const sections: Section[] = useMemo(() => {
    const out: Section[] = []

    const events = data.events || []
    if (events.length > 0) {
      out.push({
        id: 'events',
        label: t('suggest.events', { defaultValue: 'Events' }),
        rows: events.map((e) => ({
          kind: 'event' as const,
          key: `event-${e.id}`,
          id: e.id,
          title: e.title,
          image: e.image,
          meta: [formatRowDate(e.date), e.city].filter(Boolean).join(' · '),
        })),
      })
    }

    const organizers = data.organizers || []
    if (organizers.length > 0) {
      out.push({
        id: 'organizers',
        label: t('suggest.organizers', { defaultValue: 'Organizers' }),
        rows: organizers.map((o) => ({
          kind: 'organizer' as const,
          key: `org-${o.uid}`,
          uid: o.uid,
          name: o.name,
          photo: o.photo,
          verified: o.verified,
        })),
      })
    }

    const people = data.people || []
    if (people.length > 0) {
      out.push({
        id: 'people',
        label: t('suggest.people', { defaultValue: 'People' }),
        rows: people.map((p) => ({
          kind: 'person' as const,
          key: `person-${p.uid}`,
          uid: p.uid,
          name: p.name,
          photo: p.photo,
          verified: p.verified,
          connected: p.connected,
        })),
      })
    }

    const cities = data.cities || []
    if (cities.length > 0) {
      out.push({
        id: 'cities',
        label: t('suggest.cities', { defaultValue: 'Cities' }),
        rows: cities.map((c) => ({ kind: 'city' as const, key: `city-${c}`, city: c })),
      })
    }

    return out
  }, [data, t])

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  /** Flat index of each section's first row, so grouping never breaks the arrows. */
  const sectionOffsets = useMemo(() => {
    let running = 0
    return sections.map((s) => {
      const start = running
      running += s.rows.length
      return start
    })
  }, [sections])
  const hasQuery = query.trim().length >= 2

  const activate = useCallback(
    (row: Row) => {
      setOpen(false)
      setHighlight(-1)
      switch (row.kind) {
        case 'event':
          router.push(`/events/${row.id}`)
          break
        case 'organizer':
        case 'person':
          router.push(`/profile/organizer/${row.uid}`)
          break
        case 'city':
          // A filter, not a destination — preserves the other params.
          onCitySelect(row.city)
          break
      }
    },
    [router, onCitySelect]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // The virtual keyboard's search key submits but does NOT dismiss the
    // keyboard when JS handles the submit — so on a phone the field keeps
    // focus, the keyboard keeps covering the feed, and the search reads as
    // "nothing happened" even though the results below already changed.
    // Blurring hands the screen back.
    inputRef.current?.blur()
    if (open && highlight >= 0 && highlight < flatRows.length) {
      activate(flatRows[highlight])
      return
    }
    setOpen(false)
    onSubmit(query.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setHighlight(-1)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!open || flatRows.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlight((h) => (h + 1) % flatRows.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlight((h) => (h <= 0 ? flatRows.length - 1 : h - 1))
        break
      // Enter is handled by the form's onSubmit so the plain-Enter fallback
      // stays in exactly one place.
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
    if (!value.trim()) {
      setOpen(false)
      setHighlight(-1)
      onClear?.()
    }
  }

  const optionId = (index: number) => `${listboxId}-opt-${index}`
  const activeOptionId =
    open && highlight >= 0 && highlight < flatRows.length ? optionId(highlight) : undefined

  const showNoMatches = open && hasQuery && flatRows.length === 0 && !showLoading
  const showDropdown = open && hasQuery && (flatRows.length > 0 || showLoading || showNoMatches)

  return (
    <div ref={wrapRef} className="relative flex-1">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (hasQuery && flatRows.length > 0) setOpen(true)
            }}
            placeholder={t('filters.search_placeholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.07] rounded text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand-400 text-[16px]"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-label={t('common.search', { defaultValue: 'Search' })}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        <button type="submit" className="sr-only">
          {t('common.search', { defaultValue: 'Search' })}
        </button>
      </form>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('suggest.aria_label', { defaultValue: 'Search suggestions' })}
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-xl backdrop-blur-md"
        >
          {showNoMatches && (
            <p role="presentation" className="px-4 py-3 text-[13px] text-white/50">
              {t('events.no_matches_hint', {
                defaultValue: 'No matches. Press Enter to search all',
              })}
            </p>
          )}

          {sections.map((section, sectionIndex) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.label}
              className={sectionIndex > 0 ? 'border-t border-white/[0.07]' : undefined}
            >
              <p
                aria-hidden
                className="px-3.5 pb-1 pt-2.5 text-[10px] font-normal uppercase tracking-[0.14em] text-white/35"
              >
                {section.label}
              </p>
              {section.rows.map((row, rowIndex) => {
                const index = sectionOffsets[sectionIndex] + rowIndex
                const isActive = index === highlight
                return (
                  <div
                    key={row.key}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                  >
                    <button
                      type="button"
                      // onMouseDown fires before any blur, so the click always lands.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        activate(row)
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      {row.kind === 'event' && (
                        <>
                          <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
                            {isRenderableImage(row.image) ? (
                              <Image
                                src={row.image as string}
                                alt=""
                                fill
                                sizes="44px"
                                className="object-cover"
                              />
                            ) : (
                              <span className="block h-full w-full bg-gradient-to-br from-brand-500 to-brand-800" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-white">
                              {row.title}
                            </span>
                            {row.meta && (
                              <span className="mt-0.5 block truncate text-[12px] text-white/50">
                                {row.meta}
                              </span>
                            )}
                          </span>
                        </>
                      )}

                      {(row.kind === 'organizer' || row.kind === 'person') && (
                        <>
                          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
                            {isRenderableImage(row.photo) ? (
                              <Image
                                src={row.photo as string}
                                alt=""
                                fill
                                sizes="44px"
                                className="object-cover"
                              />
                            ) : row.kind === 'organizer' ? (
                              <Users className="h-4 w-4 text-white/40" />
                            ) : (
                              <User className="h-4 w-4 text-white/40" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[14px] font-medium text-white">
                                {row.name}
                              </span>
                              {row.verified && (
                                <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-400" />
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-white/50">
                              {row.kind === 'organizer'
                                ? t('suggest.role_organizer', { defaultValue: 'Organizer' })
                                : row.connected
                                  ? t('suggest.role_friend', { defaultValue: 'Friend' })
                                  : t('suggest.role_person', { defaultValue: 'On Tikèm' })}
                            </span>
                          </span>
                        </>
                      )}

                      {row.kind === 'city' && (
                        <>
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/10">
                            <MapPin className="h-4 w-4 text-white/40" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-white">
                              {row.city}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-white/50">
                              {t('suggest.city_filter_hint', {
                                defaultValue: 'Filter events by city',
                              })}
                            </span>
                          </span>
                        </>
                      )}

                      {isActive && <ArrowUpRight className="h-4 w-4 shrink-0 text-brand-400" />}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}

          {showLoading && (
            <p
              role="presentation"
              aria-live="polite"
              className={`px-3.5 py-2.5 text-[12px] text-white/35 ${
                sections.length > 0 ? 'border-t border-white/[0.07]' : ''
              }`}
            >
              {t('suggest.searching', { defaultValue: 'Searching…' })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchSuggest
