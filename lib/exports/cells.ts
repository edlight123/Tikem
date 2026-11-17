/**
 * Cell helpers shared by the Excel and PDF renderers.
 */
import type { CellValue, ExportColumn, ExportSection, MoneyValue, StatusTone, StatusValue } from './types'

export function isStatus(v: unknown): v is StatusValue {
  return !!v && typeof v === 'object' && !(v instanceof Date) && typeof (v as StatusValue).label === 'string' && 'tone' in (v as object)
}

export function isMoney(v: unknown): v is MoneyValue {
  return !!v && typeof v === 'object' && !(v instanceof Date) && typeof (v as MoneyValue).amount === 'number' && 'currency' in (v as object)
}

/**
 * Text safe for a spreadsheet cell: no XML-invalid control characters (they
 * corrupt the workbook), capped at Excel's 32,767-character cell limit.
 * Strings are always written as string cells, never formulas, so a buyer
 * named "=HYPERLINK(…)" stays inert (the CSV-era apostrophe trick is not
 * needed: a string cell is never evaluated).
 */
export function safeText(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, '').slice(0, 32000)
}

export function toDateValue(v: CellValue): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    return Number.isFinite(d.getTime()) ? d : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v)
  return null
}

export function toNumber(v: CellValue): number | null {
  if (isMoney(v)) return Number.isFinite(v.amount) ? v.amount : null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}

export function currencyOf(col: ExportColumn, v: CellValue): string {
  if (isMoney(v)) return String(v.currency || col.currency || '').toUpperCase()
  return String(col.currency || '').toUpperCase()
}

const NUMERIC = new Set(['number', 'integer', 'money', 'percent'])
export function isNumericKind(col: ExportColumn): boolean {
  return NUMERIC.has(col.kind || 'text')
}

/**
 * The totals for a section: per column marked `total`, the sum, plus the one
 * currency when a money column is single-currency. A mixed-currency money
 * column gets no total (adding HTG to USD means nothing).
 */
export function sectionTotals(section: ExportSection): Map<string, { sum: number; currency: string }> {
  const out = new Map<string, { sum: number; currency: string }>()
  if (!section.totals) return out
  for (const col of section.columns) {
    if (!col.total) continue
    let sum = 0
    const currencies = new Set<string>()
    for (const row of section.rows) {
      const n = toNumber(row[col.key])
      if (n == null) continue
      sum += n
      if (col.kind === 'money') currencies.add(currencyOf(col, row[col.key]))
    }
    if (col.kind === 'money' && currencies.size > 1) continue
    out.set(col.key, { sum: Math.round(sum * 100) / 100, currency: Array.from(currencies)[0] || col.currency || '' })
  }
  return out
}

/**
 * The wall-clock reading of an instant in a zone, as a UTC Date. Excel dates
 * have no zone, so we store what the organizer's clock said.
 */
export function wallClock(d: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
    return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')))
  } catch {
    return d
  }
}

export const TONE_HEX: Record<StatusTone, string> = {
  positive: '#12A150',
  warning: '#D18B00',
  negative: '#D93A3A',
  neutral: '#9A9A9A',
}

/** Default width hint (characters) per kind. */
export function widthHint(col: ExportColumn): number {
  if (col.width) return col.width
  switch (col.kind) {
    case 'money':
      return 14
    case 'number':
    case 'percent':
      return 10
    case 'integer':
      return 9
    case 'date':
      return 12
    case 'datetime':
      return 17
    case 'status':
      return 13
    default:
      return 18
  }
}

/** "moncash" → "MonCash": the payment rails as people know them. Unknown codes pass through, tidied. */
const METHOD_NAMES: Record<string, string> = {
  moncash: 'MonCash',
  natcash: 'NatCash',
  sogepay: 'SogePay',
  stripe: 'Card',
  stripe_connect: 'Card',
  card: 'Card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  cash: 'Cash',
  free: 'Free',
  comp: 'Comp',
}

export function paymentMethodLabel(method: string | null | undefined): string {
  const raw = String(method || '').trim()
  if (!raw) return ''
  const known = METHOD_NAMES[raw.toLowerCase()]
  if (known) return known
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
