'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { intlLocaleFor } from '@/lib/dateLocale'

export type Picked = { id: string; title: string; meta: string }
export type Created = { id: string; title: string; skipped?: boolean; flags?: string[]; sourceCurrency?: string | null }

export const buttonPrimary =
  'inline-flex h-10 items-center justify-center rounded bg-inverse px-5 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50'
export const buttonQuiet =
  'inline-flex h-10 items-center justify-center rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high disabled:opacity-50'

export function useWhen() {
  const { i18n } = useTranslation()
  return (iso: string) => {
    try {
      return new Intl.DateTimeFormat(intlLocaleFor(i18n.language), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    } catch {
      return ''
    }
  }
}

/** Rows to pick from: a fill per row, the selected one a step brighter. */
export function PickList({ items, picked, onToggle, onAll }: { items: Picked[]; picked: Set<string>; onToggle: (id: string) => void; onAll: () => void }) {
  const { t } = useTranslation('organizer')
  const all = picked.size === items.length
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-fg-muted">{t('import_page.found', { count: items.length })}</p>
        <button type="button" onClick={onAll} className="text-sm font-semibold text-fg hover:text-fg-muted">
          {all ? t('import_page.select_none') : t('import_page.select_all')}
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((it) => {
          const on = picked.has(it.id)
          return (
            <li key={it.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(it.id)}
                className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-left transition-colors ${on ? 'bg-surface-high' : 'bg-surface hover:bg-surface-high'}`}
              >
                <span className={`grid h-5 w-5 flex-none place-items-center rounded ${on ? 'bg-inverse text-on-inverse' : 'bg-surface-raised'}`}>
                  {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">{it.title}</span>
                  <span className="block truncate text-xs text-fg-muted">{it.meta}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** What was imported: each draft with a way to review it, and what to check first. */
export function DoneList({ items }: { items: Created[] }) {
  const { t } = useTranslation('organizer')
  const made = items.filter((d) => !d.skipped)
  return (
    <div>
      <p className="text-sm text-fg-muted">{t('import_page.drafts_ready', { count: made.length })}</p>
      <ul className="mt-2 space-y-1">
        {items.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded bg-surface px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg">{d.title}</span>
              {d.skipped ? (
                <span className="block text-xs text-fg-muted">{t('import_page.skipped')}</span>
              ) : d.flags?.length ? (
                <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-warning" aria-hidden />
                  {d.flags.includes('currency_unsupported')
                    ? t('import_page.flag_currency', { currency: d.sourceCurrency || '' })
                    : d.flags.includes('country_unsupported')
                      ? t('import_page.flag_country')
                      : t('import_page.flag_price')}
                </span>
              ) : (
                <span className="block text-xs text-fg-muted">{t('import_page.draft')}</span>
              )}
            </span>
            {!d.skipped && (
              <Link href={`/organizer/events/${d.id}/edit`} className="flex-none text-sm font-semibold text-fg underline-offset-4 hover:underline">
                {t('import_page.review')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
