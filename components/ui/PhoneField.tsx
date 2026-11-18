'use client'

/**
 * One phone input for the whole app: a country picker plus the national number,
 * storing E.164.
 *
 * Every phone field here used to be a bare `<input type="tel">` where people
 * typed whatever they liked — "34 12 56 78", "+509 3412", "011509…" — so the
 * same person's number was stored three different ways and none of them could
 * be dialled reliably. The picker makes the country explicit and the value
 * canonical (`+50934125678`), which is what "well formatted" has to mean if
 * anything downstream is ever going to send an SMS to it.
 *
 * Haiti, the US, Canada and France sit at the top of the list (owner ask); see
 * lib/phoneCountries for why the option value is the ISO code and not the
 * dialling code.
 *
 * Surface follows the house rule: a real fill, no hairline ring around an
 * empty box. The two controls sit in ONE bordered-looking shell so they read
 * as a single field rather than two, which is the only reason the shell exists.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  PHONE_COUNTRIES,
  DEFAULT_PHONE_ISO,
  countryByIso,
  fromE164,
  normalizeTyped,
  toE164,
} from '@/lib/phoneCountries'

export default function PhoneField({
  value,
  onChange,
  id = 'phone',
  name = 'phone',
  autoComplete = 'tel',
  required = false,
  invalid = false,
  disabled = false,
  className = '',
  ariaLabel,
}: {
  /** Stored value, E.164 (`+50934125678`) or legacy free text. */
  value: string
  /** Receives E.164, or '' when the national part is empty. */
  onChange: (e164: string) => void
  id?: string
  name?: string
  autoComplete?: string
  required?: boolean
  invalid?: boolean
  /** Locks both controls — e.g. while a checkout is submitting. */
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const { t } = useTranslation('common')

  // Local (iso, national) state, seeded from the stored value ONCE.
  //
  // It cannot be derived on every render: `toE164` drops the country when the
  // national part is empty, so clearing the number would reset the picker back
  // to Haiti mid-edit and the caller would fight the user for the country.
  const initial = useMemo(() => fromE164(value), [])
  const [iso, setIso] = useState(initial.iso)
  const [national, setNational] = useState(initial.national)

  // Adopt an externally-set value (a form reset, or a profile loading late),
  // but only when it disagrees with what this field is already showing —
  // otherwise every keystroke would round-trip through the parent.
  useEffect(() => {
    if (value === toE164(iso, national)) return
    const next = fromE164(value)
    setIso(next.iso)
    setNational(next.national)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const country = countryByIso(iso) || countryByIso(DEFAULT_PHONE_ISO)!

  const push = (nextIso: string, nextNational: string) => {
    setIso(nextIso)
    setNational(nextNational)
    onChange(toE164(nextIso, nextNational))
  }

  return (
    <div
      className={`flex items-stretch gap-2 rounded-lg bg-surface transition-colors focus-within:ring-2 focus-within:ring-brand-400/50 ${
        invalid ? 'ring-2 ring-danger/60' : ''
      } ${disabled ? 'pointer-events-none opacity-60' : ''} ${className}`}
    >
      {/* The country. A real <select> under a styled face: the native picker is
          a full-height wheel on a phone, which is far better for a 90-item
          list than anything hand-rolled, and it comes with search on desktop. */}
      <label className="relative flex shrink-0 cursor-pointer items-center gap-1.5 pl-3 pr-2">
        <span aria-hidden className="text-lead leading-none">
          {country.flag}
        </span>
        <span className="text-base font-medium tabular-nums text-fg">+{country.dial}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <select
          value={iso}
          onChange={(e) => push(e.target.value, national)}
          disabled={disabled}
          aria-label={t('phone.country', { defaultValue: 'Country code' })}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent text-transparent opacity-0 outline-none"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso} className="bg-surface-solid text-fg">
              {c.flag} {c.name} +{c.dial}
            </option>
          ))}
        </select>
      </label>

      <span aria-hidden className="my-2 w-px shrink-0 bg-surface-raised" />

      {/* The national number. A paste is interpreted rather than merely
          stripped: "+509 3412 5678" moves the picker to Haiti and fills in
          34125678, instead of becoming +50950934125678. See normalizeTyped. */}
      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        value={national}
        onChange={(e) => {
          const next = normalizeTyped(e.target.value, iso)
          push(next.iso, next.national)
        }}
        aria-label={ariaLabel || t('phone.number', { defaultValue: 'Phone number' })}
        placeholder={t('phone.placeholder', { defaultValue: '34 12 56 78' })}
        // 16px: iOS zooms the page on focus below that.
        className="min-w-0 flex-1 bg-transparent py-3 pr-4 text-base text-fg placeholder:text-fg-faint focus:outline-none"
      />
    </div>
  )
}
