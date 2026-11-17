import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError } from '@/lib/api/admin-response'
import { isoDay, parseExportFormat } from '@/lib/exports/fileName'
import { EXPORT_LABELS } from '@/lib/exports/labels'
import { exportResponse } from '@/lib/exports/respond'
import type { CellValue, ColumnKind, ExportColumn, ExportReport, ExportSection, StatusTone } from '@/lib/exports/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/admin/exports/render  { format, title, reportLabel, subtitle?, sections }
 *
 * Renders a table the admin console already holds (orders it fetched, the
 * verification queue, the payout queue) as Excel or PDF. The spreadsheet
 * engine is server-only, so console pages send the rows here rather than
 * bundling it. Admins only; it renders exactly what it is sent and reads
 * nothing, so it exposes no data the caller does not already have.
 */
const KINDS = new Set<ColumnKind>(['text', 'number', 'integer', 'money', 'percent', 'date', 'datetime', 'status'])
const TONES = new Set<StatusTone>(['positive', 'warning', 'negative', 'neutral'])
const MAX_ROWS = 20_000
const MAX_COLS = 40

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max)
}

function cell(v: unknown): CellValue {
  if (v == null) return null
  if (typeof v === 'string') return v.slice(0, 2000)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string' && TONES.has(o.tone as StatusTone)) return { label: str(o.label, 80), tone: o.tone as StatusTone }
    if (typeof o.amount === 'number' && Number.isFinite(o.amount)) return { amount: o.amount, currency: str(o.currency, 8).toUpperCase() }
  }
  return null
}

function column(raw: any): ExportColumn | null {
  const key = str(raw?.key, 60)
  if (!key) return null
  const kind = KINDS.has(raw?.kind) ? (raw.kind as ColumnKind) : 'text'
  return {
    key,
    header: str(raw?.header, 80),
    kind,
    currency: raw?.currency ? str(raw.currency, 8).toUpperCase() : undefined,
    width: Number.isFinite(raw?.width) ? Math.max(4, Math.min(80, Number(raw.width))) : undefined,
    total: raw?.total === true,
    pdf: raw?.pdf === false ? false : undefined,
  }
}

export async function POST(request: Request) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError('Unauthorized', 401)

  let body: any
  try {
    body = await request.json()
  } catch {
    return adminError('Invalid body', 400)
  }
  const format = parseExportFormat(body?.format)
  if (!format) return adminError('Invalid format', 400, 'format must be xlsx or pdf')

  const sections: ExportSection[] = []
  for (const s of Array.isArray(body?.sections) ? body.sections.slice(0, 5) : []) {
    const columns = (Array.isArray(s?.columns) ? s.columns.slice(0, MAX_COLS) : []).map(column).filter(Boolean) as ExportColumn[]
    if (!columns.length) continue
    const rows = (Array.isArray(s?.rows) ? s.rows.slice(0, MAX_ROWS) : []).map((r: any) => {
      const out: Record<string, CellValue> = {}
      for (const c of columns) out[c.key] = cell(r?.[c.key])
      return out
    })
    sections.push({ name: str(s?.name, 60) || 'Sheet', columns, rows, totals: s?.totals === true, note: s?.note ? str(s.note, 300) : undefined })
  }
  if (!sections.length) return adminError('Nothing to export', 400)

  const title = str(body?.title, 120) || 'Tikèm'
  const reportLabel = str(body?.reportLabel, 60) || 'Export'
  const timeZone = 'America/Port-au-Prince'
  const report: ExportReport = {
    title,
    reportLabel,
    subtitle: (Array.isArray(body?.subtitle) ? body.subtitle.slice(0, 3) : []).map((x: unknown) => str(x, 160)),
    organizerName: 'Tikèm admin',
    stats: (Array.isArray(body?.stats) ? body.stats.slice(0, 6) : []).map((x: any) => ({ label: str(x?.label, 40), value: str(x?.value, 60) })),
    sections,
    locale: 'en-US',
    timeZone,
    labels: EXPORT_LABELS.en,
  }
  try {
    return await exportResponse(report, format, { title, label: reportLabel, day: isoDay(new Date(), timeZone) })
  } catch (e) {
    console.error('[admin/exports/render] failed', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
