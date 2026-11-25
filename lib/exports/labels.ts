/**
 * The words every export shares (generated line, page numbers, totals), in the
 * three app languages. Report-specific column headers live with each route.
 */
import type { ExportLabels } from './types'
import { haitiHourOptions, isHaitiZone } from '@/lib/datetime/eventClock'

export type ExportLang = 'en' | 'fr' | 'ht'

export function exportLang(raw: string | null | undefined): ExportLang {
  const v = String(raw || '').toLowerCase().slice(0, 2)
  return v === 'fr' || v === 'ht' ? v : 'en'
}

export const EXPORT_LOCALE: Record<ExportLang, string> = { en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' }

export const EXPORT_LABELS: Record<ExportLang, ExportLabels> = {
  en: { generated: 'Generated', total: 'Total', empty: 'Nothing to show yet', page: (n, t) => `Page ${n} of ${t}` },
  fr: { generated: 'Généré le', total: 'Total', empty: 'Rien à afficher pour le moment', page: (n, t) => `Page ${n} sur ${t}` },
  ht: { generated: 'Fèt', total: 'Total', empty: 'Poko gen anyen pou montre', page: (n, t) => `Paj ${n} sou ${t}` },
}

/** "Generated 16 Nov, 14:05" in the report's zone. */
export function generatedLine(lang: ExportLang, timeZone: string, at = new Date()): string {
  const locale = EXPORT_LOCALE[lang]
  let when: string
  try {
    when = new Intl.DateTimeFormat(locale, {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      // Haiti reads AM/PM in every language (lib/datetime/eventClock).
      ...haitiHourOptions(isHaitiZone(timeZone)),
    }).format(at)
  } catch {
    when = at.toISOString().slice(0, 16).replace('T', ' ')
  }
  return `${EXPORT_LABELS[lang].generated} ${when}`
}
