'use client'

// The place being browsed, as the second half of the nav search bar (and a
// small chip on phones). It replaces the old city row under the nav, which
// read as an empty strip (owner 2026-11-24: "remove the city pill, make it
// more like Tikra with the search bar, keep it clean").
//
// One menu: the visitor's cities that actually have upcoming events (with
// their counts) when there is more than one, then the countries Tikèm lists.
// A city is a plain link to /?country=…&city=…, so a view stays shareable and
// the server renders it whole; a country choice is remembered in a cookie.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HomeCity } from '@/lib/home/feed'
import { SUPPORTED_COUNTRIES, saveCountryChoice, type CountryCode } from '@/lib/home/country'

export interface NavLocation {
  country: CountryCode
  cities: HomeCity[]
  /** Folded key of the chosen city, or null for the whole country. */
  active: string | null
  total: number
}

export default function LocationMenu({ location, inline = false }: { location: NavLocation; inline?: boolean }) {
  const { country, cities, active, total } = location
  const { t } = useTranslation('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"], [aria-current="page"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const countryName = (c: CountryCode) => t(`home.country.${c}`, { defaultValue: c })
  const activeCity = cities.find((c) => c.key === active)
  // A single city is where the page is, so it names the chip.
  const label = activeCity?.name ?? (cities.length === 1 ? cities[0].name : countryName(country))

  const chooseCountry = (c: CountryCode) => {
    setOpen(false)
    saveCountryChoice(c)
    router.push(`/?country=${c}`, { scroll: false })
  }

  const itemClass = (current: boolean) =>
    `flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised ${
      current ? 'text-fg' : 'text-fg-muted'
    }`
  const dot = (current: boolean) => (
    <span aria-hidden className={`h-1.5 w-1.5 flex-none rounded-full ${current ? 'bg-brand-500' : 'bg-transparent'}`} />
  )

  return (
    <div ref={wrap} className="relative flex-none">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('home.country.change', { defaultValue: 'Change country' })}: ${label}`}
        onClick={() => setOpen((v) => !v)}
        className={
          inline
            ? 'flex h-10 items-center gap-1.5 whitespace-nowrap rounded-r px-3 text-meta font-medium text-fg-soft outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-fg/70'
            : 'flex h-9 max-w-[9.5rem] items-center gap-1 rounded bg-surface px-2.5 text-meta font-medium text-fg-soft outline-none transition-colors hover:bg-surface-raised hover:text-fg focus-visible:ring-2 focus-visible:ring-fg/70'
        }
      >
        {inline && <MapPin aria-hidden className="h-3.5 w-3.5 flex-none text-fg-subtle" />}
        <span className="truncate">{label}</span>
        <ChevronDown
          aria-hidden
          className={`h-3.5 w-3.5 flex-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('home.country.aria', { defaultValue: 'Choose a country' })}
          className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-56 overflow-y-auto rounded bg-surface-raised-solid p-1.5"
        >
          {cities.length > 1 && (
            <div className="mb-1.5 pb-1.5" aria-label={t('home.city.aria', { defaultValue: 'Choose a city' })}>
              {[
                { key: null as string | null, name: t('home.city.all', { defaultValue: 'All' }), count: total, href: `/?country=${country}&city=all` },
                ...cities.map((c) => ({
                  key: c.key as string | null,
                  name: c.name,
                  count: c.count,
                  href: `/?country=${country}&city=${encodeURIComponent(c.name)}`,
                })),
              ].map((item) => {
                const current = item.key === active
                return (
                  <Link
                    key={item.key ?? 'all'}
                    href={item.href}
                    scroll={false}
                    role="menuitem"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={itemClass(current)}
                  >
                    {dot(current)}
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="font-mono text-eyebrow tabular-nums text-fg-faint">{item.count}</span>
                  </Link>
                )
              })}
              <div aria-hidden className="mx-3 mt-1.5 h-px bg-surface-high" />
            </div>
          )}
          {SUPPORTED_COUNTRIES.map((c) => {
            const current = c === country
            return (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => chooseCountry(c)}
                className={itemClass(current)}
              >
                {dot(current)}
                {countryName(c)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
