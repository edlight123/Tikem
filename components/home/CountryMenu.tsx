'use client'

// "Change country": a quiet text button at the end of the city row that opens
// a short menu of the countries Tikèm lists. Choosing one remembers it (a
// cookie the server reads on the next visit) and navigates to /?country=…,
// so the scope is also shareable as a link.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_COUNTRIES, saveCountryChoice, type CountryCode } from '@/lib/home/country'

export default function CountryMenu({ country }: { country: CountryCode }) {
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
    // Focus the current choice so the keyboard lands inside the menu.
    wrap.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = (c: CountryCode) => t(`home.country.${c}`, { defaultValue: c })

  const choose = (c: CountryCode) => {
    setOpen(false)
    saveCountryChoice(c)
    router.push(`/?country=${c}`, { scroll: false })
  }

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('home.country.change', { defaultValue: 'Change country' })}: ${name(country)}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] leading-none text-white/45 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="text-white/75">{name(country)}</span>
        <span className="hidden sm:inline">· {t('home.country.change', { defaultValue: 'Change country' })}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('home.country.aria', { defaultValue: 'Choose a country' })}
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl bg-[#1c1c1c] p-1.5"
        >
          {SUPPORTED_COUNTRIES.map((c) => {
            const current = c === country
            return (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => choose(c)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] outline-none transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.1] ${
                  current ? 'text-white' : 'text-white/65'
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${current ? 'bg-[#14B8A6]' : 'bg-transparent'}`}
                />
                {name(c)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
