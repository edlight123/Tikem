/**
 * One description of a report, rendered two ways: an Excel workbook
 * (lib/exports/xlsx.ts) and a printable PDF (lib/exports/pdf.ts). Routes build
 * an ExportReport from the data they already select and hand it to
 * exportResponse (lib/exports/respond.ts); they never format cells themselves.
 *
 * Owner, 2026-11-16: every export is Excel + PDF, no CSV, and they look
 * premium. Keep this file free of server-only imports: the client download
 * helpers share its types.
 */

export type ExportFormat = 'xlsx' | 'pdf'

export type ColumnKind =
  | 'text'
  | 'number'
  | 'integer'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'status'

export type StatusTone = 'positive' | 'warning' | 'negative' | 'neutral'

/** A state shown as a coloured dot + label (never a filled pill). */
export interface StatusValue {
  label: string
  tone: StatusTone
}

/** An amount in MAJOR units with its own currency (for mixed-currency columns). */
export interface MoneyValue {
  amount: number
  currency: string
}

export type CellValue = string | number | boolean | Date | null | undefined | StatusValue | MoneyValue

export interface ExportColumn {
  key: string
  header: string
  kind?: ColumnKind
  /** Fixed ISO currency for a `money` column whose cells are plain numbers (major units). */
  currency?: string
  /** Width hint in characters. Excel uses it directly; the PDF scales it to the page. */
  width?: number
  /** Sum this column in the totals row. */
  total?: boolean
  /** Leave this column out of the PDF (long ids that only matter in a spreadsheet). */
  pdf?: boolean
}

export interface ExportSection {
  /** Sheet name in Excel, section heading in the PDF. */
  name: string
  columns: ExportColumn[]
  rows: Record<string, CellValue>[]
  /** Add a totals row summing the columns marked `total`. */
  totals?: boolean
  /** One muted line under the section heading (PDF) / above the table (Excel). */
  note?: string
}

export interface ExportStat {
  label: string
  value: string
}

export interface ExportLabels {
  generated: string
  total: string
  empty: string
  page: (n: number, total: number) => string
}

export interface ExportReport {
  /** The event title, or the organization name for org-wide reports. */
  title: string
  /** What this file is: "Sales audit", "Payouts"… Shown above the title. */
  reportLabel: string
  /** Date · venue, a period, etc. One entry per line. */
  subtitle?: string[]
  organizerName?: string
  /** Deep header colour '#rrggbb' (the event's poster tone). Defaults to ink. */
  tone?: string
  /** JPEG bytes of the poster, already resized (PDF only). */
  poster?: Buffer | null
  /** Headline figures shown under the header. */
  stats?: ExportStat[]
  sections: ExportSection[]
  /** BCP-47 locale for dates and numbers in the PDF ('en-US', 'fr-FR'…). */
  locale: string
  /** IANA zone the dates are shown in (the event's or the market's). */
  timeZone: string
  generatedAt?: Date
  labels: ExportLabels
}
