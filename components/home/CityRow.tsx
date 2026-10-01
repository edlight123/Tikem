'use client'

// The city row under the nav. It lists only the cities of the visitor's
// country that actually have upcoming events (with their real counts), and
// the chosen one carries the teal dot: teal here means "this is where you
// are". Each city is a plain link to /?country=…&city=…, so a view is
// shareable and the server renders it whole. "Change country" sits at the
// end, outside the scroller, so a phone can always reach it.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import type { HomeCity } from '@/lib/home/feed'
import type { CountryCode } from '@/lib/home/country'
import CountryMenu from '@/components/home/CountryMenu'

export default function CityRow({
  country,
  cities,
  active,
  total,
}: {
  country: CountryCode
  cities: HomeCity[]
  active: string | null
  total: number
}) {
  const { t } = useTranslation('common')

  // One city is not a choice: the row then carries only the country control.
  const items =
    cities.length < 2
      ? []
      : [
          {
            key: null as string | null,
            name: t('home.city.all', { defaultValue: 'All' }),
            href: `/?country=${country}&city=all`,
            count: total,
          },
          ...cities.map((c) => ({
            key: c.key as string | null,
            name: c.name,
            href: `/?country=${country}&city=${encodeURIComponent(c.name)}`,
            count: c.count,
          })),
        ]

  return (
    <div className="relative z-30 bg-black">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-2 py-2 sm:px-4 lg:px-6">
        <nav aria-label={t('home.city.aria', { defaultValue: 'Choose a city' })} className="min-w-0 flex-1">
          <ul className="flex items-center gap-1 overflow-x-auto pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [scrollbar-width:none] sm:pr-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
            {/* A single city still says where the page is. */}
            {cities.length === 1 && (
              <li className="flex h-10 shrink-0 items-center gap-2 px-2.5 font-grotesk text-[15px] font-medium leading-none text-white">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
                {cities[0].name}
                <span className="font-mono text-[10px] tabular-nums text-white/30">{cities[0].count}</span>
              </li>
            )}
            {items.map((item) => {
              const isActive = item.key === active
              return (
                <li key={item.key ?? 'all'} className="shrink-0">
                  <Link
                    href={item.href}
                    scroll={false}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex h-10 items-center gap-2 rounded-lg px-2.5 font-grotesk text-[15px] font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${
                      isActive ? 'text-white' : 'text-white/45 hover:text-white/85'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full transition-colors ${
                        isActive ? 'bg-[#14B8A6]' : 'bg-transparent'
                      }`}
                    />
                    {item.name}
                    <span className="font-mono text-[10px] tabular-nums text-white/30">{item.count}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <CountryMenu country={country} />
      </div>
    </div>
  )
}
