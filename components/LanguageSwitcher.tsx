'use client'

/**
 * Pick the site's language. Lives in the footer, which is where a reader looks
 * for it and the one place present on every page.
 *
 * Two things make this more than a `changeLanguage` call:
 *
 * 1. **The server has to be told.** `i18n.changeLanguage` re-renders client
 *    components immediately, but every server component on this site reads the
 *    language from the `i18nextLng` cookie at request time and resolves its
 *    text from a local DICT (see app/layout.tsx) — /vision, /platform, the
 *    legal pages and the event page's metadata all work that way. i18next's
 *    detector writes that cookie, so a `router.refresh()` afterwards is what
 *    makes the SERVER-rendered half of the page follow. Without it a reader
 *    switches to Kreyòl and half the page stays in English.
 *
 * 2. **Endonyms.** The options read "English / Français / Kreyòl", each in its
 *    own language, not "French / Haitian Creole" in the current one. Somebody
 *    who has landed on a page they cannot read needs to recognise their
 *    language, which they cannot do if it is labelled in a language they do
 *    not speak.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'

/** Endonyms — see the note above. `short` is for the narrowest layouts. */
const LANGUAGES = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'fr', name: 'Français', short: 'FR' },
  { code: 'ht', name: 'Kreyòl', short: 'KR' },
] as const

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation('common')
  const [pending, setPending] = useState(false)

  const current = (i18n.language || 'en').slice(0, 2)

  /**
   * Change the language, then RELOAD — not `router.refresh()`.
   *
   * Refresh re-renders server components but leaves the document shell alone,
   * and `<html lang>` is set by the root layout from the cookie at request
   * time. Measured: after a refresh the cookie read `ht` while `<html lang>`
   * still read `en`, which tells a screen reader to pronounce Kreyòl with
   * English phonetics and tells the browser to offer to translate a page that
   * is already in the reader's language.
   *
   * A reload also removes any doubt about the server half: /vision, /platform,
   * the legal pages and the event page's metadata each resolve their own text
   * from the cookie, and a language change is a deliberate, rare action where
   * a full load is the honest cost of being certain.
   *
   * `changeLanguage` is awaited because it is what writes the cookie; reloading
   * before it settles would send the old language back to the server.
   */
  const pick = async (code: string) => {
    if (code === current || pending) return
    setPending(true)
    try {
      await i18n.changeLanguage(code)
    } catch {
      /* the reload below re-reads whatever did get stored */
    }
    window.location.reload()
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Languages className="h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden />
      <div
        role="group"
        aria-label={t('footer.language', { defaultValue: 'Language' })}
        className={`flex items-center gap-1 ${pending ? 'pointer-events-none opacity-50' : ''}`}
      >
        {LANGUAGES.map((l) => {
          const on = l.code === current
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => void pick(l.code)}
              aria-pressed={on}
              // `lang` on the button itself, so a screen reader pronounces
              // "Français" in French rather than reading it as English.
              lang={l.code}
              // The app-wide chip spec: 10px radius, ~30px of ink, and the
              // 44px touch target supplied by the ::after inset rather than by
              // making the chip tall.
              className={`relative rounded px-2.5 py-1.5 text-[13px] leading-[18px] font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] ${
                on
                  ? 'bg-white text-black'
                  : 'text-white/50 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {/* The full endonym where there is room; the two-letter code on
                  a narrow phone footer, where three full names would wrap. */}
              <span className="hidden sm:inline">{l.name}</span>
              <span className="sm:hidden">{l.short}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
