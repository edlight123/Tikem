'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Tag, Globe, ChevronDown } from 'lucide-react'
import { LOCATION_CONFIG, CATEGORIES, getLocationTypeLabel, getSubdivisions, getCitiesForCountry } from '@/lib/filters/config'
import type { UserProfile } from '@/lib/firestore/user-profile'
import { ProfileSection, Panel, FieldLabel } from './ui'

interface PreferencesCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

/**
 * Discovery preferences: where you are, what you like, what language you read.
 *
 * Before: the "default location" summary was `border border-brand-100` — a
 * near-white teal hairline around an unfilled box — and all three selects were
 * `border border-white/10` with no fill, no text colour and the UA's own
 * chevron, so on a black page they were empty outlines. The category and
 * language buttons were filled `bg-teal-600`, which spends the page's whole teal
 * budget on "chosen"; the ladder says a chosen chip is the one pure white thing.
 *
 * Now: the summary is a filled read-out, the selects are filled fields with our
 * own chevron, and language is one segmented control instead of three loose
 * pills. Data, handlers and save-on-change behaviour are untouched.
 */
const SELECT =
  'w-full appearance-none rounded-xl bg-white/[0.06] px-3.5 py-3 pr-11 text-[16px] text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-[#141414] [&>option]:text-white'

export function PreferencesCard({ profile, onUpdate }: PreferencesCardProps) {
  const { i18n, t } = useTranslation('profile')
  const [defaultCountry, setDefaultCountry] = useState(profile.defaultCountry || 'HT')
  const [defaultCity, setDefaultCity] = useState(profile.defaultCity || '')
  const [defaultSubarea, setDefaultSubarea] = useState(profile.defaultSubarea || '')
  const [favoriteCategories, setFavoriteCategories] = useState<string[]>(profile.favoriteCategories || [])
  const [language, setLanguage] = useState(profile.language || 'en')
  const [isUpdating, setIsUpdating] = useState(false)

  // Get cities for selected country
  const cities = useMemo(() => {
    return getCitiesForCountry(defaultCountry)
  }, [defaultCountry])

  // Get current subdivisions based on selected city
  const subdivisions = useMemo(() => {
    return defaultCity ? getSubdivisions(defaultCity, defaultCountry) : []
  }, [defaultCity, defaultCountry])

  const subareaLabel = defaultCity ? getLocationTypeLabel(defaultCity, defaultCountry) : 'Area'

  // Reset city and subarea when country changes
  useEffect(() => {
    const availableCities = getCitiesForCountry(defaultCountry)
    if (defaultCity && !availableCities.includes(defaultCity)) {
      setDefaultCity('')
      setDefaultSubarea('')
    }
  }, [defaultCountry, defaultCity])

  // Reset subarea when city changes
  useEffect(() => {
    if (defaultCity && !subdivisions.includes(defaultSubarea)) {
      setDefaultSubarea('')
    }
  }, [defaultCity, defaultSubarea, subdivisions])

  const handleCountryChange = async (country: string) => {
    setDefaultCountry(country)
    setDefaultCity('') // Reset city
    setDefaultSubarea('') // Reset subarea
    setIsUpdating(true)
    try {
      await onUpdate({
        defaultCountry: country,
        defaultCity: '',
        defaultSubarea: '',
        subareaType: 'COMMUNE'
      })
    } catch (error) {
      console.error('Failed to update country:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCityChange = async (city: string) => {
    setDefaultCity(city)
    setDefaultSubarea('') // Reset subarea
    setIsUpdating(true)
    try {
      const cityConfig = LOCATION_CONFIG[defaultCountry]?.cities[city]
      await onUpdate({
        defaultCity: city,
        defaultSubarea: '',
        subareaType: (cityConfig?.type.toUpperCase() || 'COMMUNE') as 'COMMUNE' | 'NEIGHBORHOOD'
      })
    } catch (error) {
      console.error('Failed to update city:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleSubareaChange = async (subarea: string) => {
    setDefaultSubarea(subarea)
    setIsUpdating(true)
    try {
      await onUpdate({ defaultSubarea: subarea })
    } catch (error) {
      console.error('Failed to update subarea:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCategoryToggle = async (category: string) => {
    const newCategories = favoriteCategories.includes(category)
      ? favoriteCategories.filter(c => c !== category)
      : [...favoriteCategories, category]

    setFavoriteCategories(newCategories)
    setIsUpdating(true)
    try {
      await onUpdate({ favoriteCategories: newCategories })
    } catch (error) {
      console.error('Failed to update categories:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleLanguageChange = async (lang: 'en' | 'fr' | 'ht') => {
    setLanguage(lang)
    setIsUpdating(true)
    try {
      // Update i18n language immediately for UI
      await i18n.changeLanguage(lang)
      // Persist to user profile
      await onUpdate({ language: lang })
    } catch (error) {
      console.error('Failed to update language:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <ProfileSection title={t('preferences.title')} description={t('preferences.subtitle')}>
      {/* The resolved default location, when all three parts are set: a filled
          read-out of what the feed is actually using. */}
      {defaultCountry && defaultCity && defaultSubarea && (
        <Panel className="mb-4 px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/55">
              <MapPin className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              {/* A span, not a p: `.mobile-typography p` would override
                  .eyebrow's size and line-height on a phone. */}
              <span className="eyebrow block text-white/40">{t('preferences.default_location')}</span>
              {/* 15px, not 17px. This line is one fact — "country · city · area"
                  — and at 17px it needed 286px in the 284px this column has
                  once the 40px tile and its gap are taken out, so on a phone it
                  broke mid-place-name ("… · Pétion-" / "Ville"). 15px brings it
                  to 252px, one line down to a 375px viewport, and it is still
                  the loudest line in the panel because it is the only bold one.
                  Only the phone is constrained, so 17px comes back at sm. */}
              <p className="mt-1 !text-[15px] font-bold !leading-snug text-white sm:!text-[17px]">
                {LOCATION_CONFIG[defaultCountry]?.name} · {defaultCity} · {defaultSubarea}
              </p>
              <p className="mt-1 !text-[12px] text-white/40">{t('preferences.location_note')}</p>
            </div>
          </div>
        </Panel>
      )}

      <div className="space-y-5">
        {/* Country */}
        <div>
          <FieldLabel htmlFor="pref-country" icon={Globe} className="mb-2">
            {t('preferences.default_country', { defaultValue: 'Country' })}
          </FieldLabel>
          <div className="relative">
            <select
              id="pref-country"
              value={defaultCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              disabled={isUpdating}
              className={SELECT}
            >
              {Object.values(LOCATION_CONFIG).map(country => (
                <option key={country.code} value={country.code}>{country.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
          </div>
        </div>

        {/* City */}
        <div>
          <FieldLabel htmlFor="pref-city" icon={MapPin} className="mb-2">
            {t('preferences.default_city')}
          </FieldLabel>
          <div className="relative">
            <select
              id="pref-city"
              value={defaultCity}
              onChange={(e) => handleCityChange(e.target.value)}
              disabled={isUpdating}
              className={SELECT}
            >
              <option value="">{t('preferences.select_city')}</option>
              {cities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
          </div>
        </div>

        {/* Subarea — only where the selected city has subdivisions */}
        {defaultCity && subdivisions.length > 0 && (
          <div>
            <FieldLabel htmlFor="pref-subarea" icon={MapPin} className="mb-2">
              {subareaLabel}
            </FieldLabel>
            <div className="relative">
              <select
                id="pref-subarea"
                value={defaultSubarea}
                onChange={(e) => handleSubareaChange(e.target.value)}
                disabled={isUpdating}
                className={SELECT}
              >
                <option value="">{t('preferences.select_area', { type: subareaLabel.toLowerCase() })}</option>
                {subdivisions.map(subarea => (
                  <option key={subarea} value={subarea}>{subarea}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
            </div>
          </div>
        )}

        {/* Favorite categories — chosen chip is the one white thing */}
        <div>
          <FieldLabel icon={Tag} className="mb-2.5">
            {t('preferences.favorite_categories')}
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(category => {
              const isSelected = favoriteCategories.includes(category)
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleCategoryToggle(category)}
                  disabled={isUpdating}
                  className={`rounded px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                    isSelected
                      ? 'bg-white text-black'
                      : 'bg-white/[0.055] text-white/70 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  {category}
                </button>
              )
            })}
          </div>
          <p className="mt-2.5 !text-[12px] text-white/35">{t('preferences.categories_note')}</p>
        </div>

        {/* Language — one segmented control, not three loose pills */}
        <div>
          <FieldLabel icon={Globe} className="mb-2">
            {t('preferences.language')}
          </FieldLabel>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.055] p-1">
            {[
              { code: 'en' as const, label: t('preferences.language_en') },
              { code: 'fr' as const, label: t('preferences.language_fr') },
              { code: 'ht' as const, label: t('preferences.language_ht') }
            ].map(({ code, label }) => (
              <button
                key={code}
                type="button"
                aria-pressed={language === code}
                onClick={() => handleLanguageChange(code)}
                disabled={isUpdating}
                className={`rounded-lg py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                  language === code
                    ? 'bg-white text-black'
                    : 'text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProfileSection>
  )
}
