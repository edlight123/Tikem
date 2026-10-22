'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CATEGORIES } from '@/lib/filters/config'
import { discoverChipCls } from './DateChips'
import { Music, Trophy, Palette, Briefcase, PartyPopper, Sparkles, Ticket, Drama, UtensilsCrossed, Users, ChevronDown, Check, X } from 'lucide-react'

interface CategoryChipsProps {
  selectedCategories: string[]
  /** Kept for API compatibility with the strip; layout is identical either way. */
  bare?: boolean
}

// Category icon mapping
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Concert': <Music className="h-4 w-4" />,
  'Party': <PartyPopper className="h-4 w-4" />,
  'Festival': <Sparkles className="h-4 w-4" />,
  'Conference': <Briefcase className="h-4 w-4" />,
  'Workshop': <Palette className="h-4 w-4" />,
  'Sports': <Trophy className="h-4 w-4" />,
  'Theater': <Drama className="h-4 w-4" />,
  'Food & Drink': <UtensilsCrossed className="h-4 w-4" />,
  'Family': <Users className="h-4 w-4" />,
  'Other': <Ticket className="h-4 w-4" />,
}

/**
 * Category quick-filter as a single compact dropdown (multi-select), replacing a
 * long row of chips. The menu is portaled to <body> so it is never clipped by
 * the horizontally-scrolling filter strip.
 */
export function CategoryChips({ selectedCategories }: CategoryChipsProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  const selected = selectedCategories || []
  const count = selected.length

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const toggle = (category: string) => {
    const params = new URLSearchParams(searchParams)
    const current = params.getAll('category')
    const updated = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category]
    params.delete('category')
    updated.forEach((cat) => params.append('category', cat))
    router.push(`?${params.toString()}`)
  }

  const clearAll = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('category')
    router.push(`?${params.toString()}`)
  }

  const label =
    count === 0
      ? t('filters.categories', { defaultValue: 'Category' })
      : count === 1
      ? t(`categories.${selected[0]}`, { defaultValue: selected[0] })
      : `${count} ${t('filters.categories', { defaultValue: 'categories' }).toLowerCase()}`

  return (
    <>
      {/* Same chip as the date row beside it — 10px radius, 34px of ink, and a
          white fill rather than a teal-bordered pill when a category is on. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={discoverChipCls(count > 0)}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('filters.categories', { defaultValue: 'Category' })}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="relative z-[101] w-full max-w-sm rounded-t-2xl bg-[#141414] p-4 shadow-2xl sm:rounded-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">{t('filters.categories', { defaultValue: 'Category' })}</h3>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((category) => {
                  const isSel = selected.includes(category)
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggle(category)}
                      // Fill-vs-fill, 10px radius: the same language as the chip
                      // that opened this sheet. The old selected tile was a teal
                      // tint inside a teal border — a coloured status pill.
                      // min-h-11 here, unlike the rail chip: this sheet has room
                      // for a proper 44px target, so it gets one.
                      className={`flex min-h-11 items-center gap-2 rounded px-3 py-2 text-left text-[13px] leading-[18px] font-medium transition-colors ${
                        isSel ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                      }`}
                    >
                      <span className={isSel ? 'text-black/55' : 'text-white/50'}>{CATEGORY_ICONS[category]}</span>
                      <span className="flex-1 truncate">{t(`categories.${category}`, { defaultValue: category })}</span>
                      {isSel && <Check className="h-4 w-4 shrink-0 text-black" />}
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 flex gap-2">
                {count > 0 && (
                  <button
                    onClick={clearAll}
                    className="flex-1 rounded bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.12]"
                  >
                    {t('filters.clear_all', { defaultValue: 'Clear all' })}
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                >
                  {t('common.done', { defaultValue: 'Done' })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
