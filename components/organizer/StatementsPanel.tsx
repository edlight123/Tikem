'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { downloadExport } from '@/lib/exports/download'
import { SectionHeader } from '@/components/organizer/ui'

/** The last 12 calendar months, newest first, as "YYYY-MM" (UTC, like the statements). */
export function recentMonths(now = new Date(), count = 12): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Finance > Monthly statements: sales, Tikra fees, refunds and payouts for a
 * month, as CSV or PDF (app/api/organizer/statements).
 */
export default function StatementsPanel() {
  const { t, i18n } = useTranslation('common')
  const months = useMemo(() => recentMonths(), [])
  const [month, setMonth] = useState(months[0])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const lang = (i18n.language || 'en').slice(0, 2) === 'fr' ? 'fr' : 'en'

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number)
    try {
      return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(i18n.language || 'en', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    } catch {
      return m
    }
  }

  async function download(format: 'csv' | 'pdf') {
    setBusy(format)
    setError(false)
    try {
      await downloadExport(
        `/api/organizer/statements?month=${encodeURIComponent(month)}&format=${format}&lang=${lang}`,
        { credentials: 'include' },
        `Tikra statement ${month}.${format}`
      )
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-10">
      <SectionHeader title={t('statements.title')} description={t('statements.subtitle')} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="statement-month">
          {t('statements.month')}
        </label>
        <select
          id="statement-month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-10 rounded bg-surface px-3 text-base text-fg focus:outline-none focus:ring-2 focus:ring-brand-400/50 sm:text-sm"
        >
          {months.map((m) => (
            <option key={m} value={m} className="bg-canvas">
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => download('csv')}
          disabled={busy !== null}
          className="inline-flex h-10 items-center gap-2 rounded bg-surface px-4 text-sm font-semibold text-fg-soft hover:bg-surface-high hover:text-fg disabled:opacity-60"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          {busy === 'csv' ? t('statements.preparing') : t('statements.download_csv')}
        </button>
        <button
          type="button"
          onClick={() => download('pdf')}
          disabled={busy !== null}
          className="inline-flex h-10 items-center gap-2 rounded bg-surface px-4 text-sm font-semibold text-fg-soft hover:bg-surface-high hover:text-fg disabled:opacity-60"
        >
          <FileText className="h-4 w-4" aria-hidden />
          {busy === 'pdf' ? t('statements.preparing') : t('statements.download_pdf')}
        </button>
      </div>
      <p className="mt-3 text-xs text-fg-subtle" role="status" aria-live="polite">
        {error ? t('statements.error') : t('statements.note')}
      </p>
    </section>
  )
}
