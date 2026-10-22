'use client'

import { useTranslation } from 'react-i18next'

import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/**
 * Dark-canvas search input with clear button.
 * Sized for touch (min-height 44px) and usable as the first child of TableToolbar.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: SearchInputProps) {
  const { t } = useTranslation('organizer')

  return (
    <div className={`relative flex min-w-0 items-center ${className}`}>
      <Search className="pointer-events-none absolute left-3 h-4 w-4 shrink-0 text-white/35" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('search_input.search_placeholder')}
        // A form field is a FILL, not a hairline around nothing: this was
        // `border-white/10` over `bg-transparent`, i.e. an outline around the
        // page. 16px keeps iOS from zooming the page on focus.
        className="h-11 w-full rounded bg-white/[0.06] pl-9 pr-8 text-[16px] text-white placeholder:text-white/30 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
      />
      {value && (
        <button
          type="button"
          aria-label={t('search_input.clear_search')}
          onClick={() => onChange('')}
          className="absolute right-2 grid h-5 w-5 place-items-center rounded text-white/40 hover:text-white/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
