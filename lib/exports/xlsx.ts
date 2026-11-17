import ExcelJS from 'exceljs'
import { PASS_LOGO } from '@/lib/wallet/brandArt'
import {
  TONE_HEX,
  currencyOf,
  isMoney,
  isNumericKind,
  isStatus,
  safeText,
  sectionTotals,
  toDateValue,
  toNumber,
  wallClock,
} from './cells'
import type { CellValue, ExportColumn, ExportReport, ExportSection } from './types'

/**
 * An ExportReport as an .xlsx workbook (server only: exceljs never reaches a
 * client bundle). One sheet per section, each one standing on its own:
 *
 *   - a header band in the event's colour (the poster tone) with the report
 *     label, the title, the subtitle lines, organizer · generated, and the
 *     tikèm wordmark;
 *   - the key figures (first sheet);
 *   - a dark header row, frozen, with an autofilter;
 *   - real typed cells: numbers, amounts with their currency format, dates
 *     (the organizer's wall clock), so the sheet sorts, filters and sums;
 *   - a totals row of SUBTOTAL formulas, which follow the autofilter;
 *   - no gridlines, hairline row rules, landscape fit-to-width printing with
 *     the header row repeated and page numbers in the footer.
 *
 * Every user string is written as a string cell, never a formula.
 */

const FONT = 'Arial'
const INK = 'FF141414'
const MUTED = 'FF6B6B6B'
const RULE = 'FFE4E4E4'
const TOTAL_FILL = 'FFF2F2F2'
const WHITE = 'FFFFFFFF'

function argb(hex: string | undefined, fallback = INK): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  return m ? `FF${m[1].toUpperCase()}` : fallback
}

function sheetName(raw: string, used: Set<string>): string {
  const base = safeText(raw).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base
  let i = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i++})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name.toLowerCase())
  return name
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function moneyFormat(currency: string): string {
  const code = currency.replace(/[^A-Z]/g, '')
  return code ? `#,##0.00 "${code}";-#,##0.00 "${code}"` : '#,##0.00'
}

function numFmtFor(col: ExportColumn, value: CellValue, lang: string): string | undefined {
  switch (col.kind) {
    case 'money':
      return moneyFormat(currencyOf(col, value))
    case 'number':
      return '#,##0.00'
    case 'integer':
      return '#,##0'
    case 'percent':
      return '0.0%'
    case 'date':
      return lang.startsWith('en') ? 'mmm d, yyyy' : 'd mmm yyyy'
    case 'datetime':
      return lang.startsWith('en') ? 'mmm d, yyyy  h:mm AM/PM' : 'd mmm yyyy  hh:mm'
    default:
      return undefined
  }
}

/** Approximate rendered length of a value, for column auto-width. */
function displayLength(col: ExportColumn, v: CellValue): number {
  if (v == null || v === '') return 0
  if (isStatus(v)) return v.label.length + 2
  switch (col.kind) {
    case 'money': {
      const n = toNumber(v)
      return n == null ? 0 : Math.abs(n).toFixed(2).length + Math.floor(Math.log10(Math.max(1, Math.abs(n))) / 3) + 5
    }
    case 'number':
    case 'integer':
    case 'percent': {
      const n = toNumber(v)
      return n == null ? 0 : String(Math.round(n * 100) / 100).length + 2
    }
    case 'date':
      return 12
    case 'datetime':
      return 20
    default:
      return Math.min(60, safeText(v).length)
  }
}

function widthsFor(section: ExportSection): number[] {
  const sample = section.rows.slice(0, 400)
  return section.columns.map((col) => {
    let max = col.header.length + 3
    for (const r of sample) max = Math.max(max, displayLength(col, r[col.key]) + 2)
    const w = Math.max(col.width || 0, Math.min(max, 46))
    return Math.max(8, Math.min(60, w))
  })
}

/** Excel column width (characters) → pixels, the usual 7px-per-char + padding. */
const pxOf = (w: number) => Math.round(w * 7 + 5)

function writeCell(cell: ExcelJS.Cell, col: ExportColumn, v: CellValue, ctx: { tz: string; lang: string }) {
  const kind = col.kind || 'text'
  if (v == null || v === '') {
    cell.value = null
    return
  }
  if (kind === 'status' || isStatus(v)) {
    const label = isStatus(v) ? safeText(v.label) : safeText(v)
    const tone = isStatus(v) ? v.tone : 'neutral'
    cell.value = {
      richText: [
        { text: '● ', font: { name: FONT, size: 9, color: { argb: argb(TONE_HEX[tone]) } } },
        { text: label, font: { name: FONT, size: 10, color: { argb: INK } } },
      ],
    }
    return
  }
  if (kind === 'date' || kind === 'datetime') {
    const d = toDateValue(v)
    if (d) {
      cell.value = wallClock(d, ctx.tz)
      cell.numFmt = numFmtFor(col, v, ctx.lang) as string
    } else {
      cell.value = safeText(v)
    }
    return
  }
  if (isNumericKind(col)) {
    const n = toNumber(v)
    if (n == null) {
      cell.value = safeText(isMoney(v) ? '' : v)
      return
    }
    cell.value = n
    const fmt = numFmtFor(col, v, ctx.lang)
    if (fmt) cell.numFmt = fmt
    return
  }
  // Plain text: always a string cell.
  cell.value = safeText(typeof v === 'boolean' ? (v ? '✓' : '') : v instanceof Date ? v.toISOString() : v)
}

function escapeHF(s: string): string {
  return s.replace(/&/g, '&&')
}

export async function renderXlsx(report: ExportReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const now = report.generatedAt || new Date()
  wb.creator = 'Tikèm'
  wb.lastModifiedBy = 'Tikèm'
  wb.company = 'Tikèm'
  wb.created = now
  wb.modified = now
  wb.title = `${report.title} – ${report.reportLabel}`
  wb.subject = report.reportLabel

  const logoId = wb.addImage({ buffer: PASS_LOGO.x3 as any, extension: 'png' })
  const tone = argb(report.tone, INK)
  const lang = report.locale
  const ctx = { tz: report.timeZone, lang }
  const used = new Set<string>()
  const generated = (() => {
    try {
      return `${report.labels.generated} ${new Intl.DateTimeFormat(report.locale, {
        timeZone: report.timeZone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(now)}`
    } catch {
      return `${report.labels.generated} ${now.toISOString().slice(0, 16).replace('T', ' ')}`
    }
  })()

  const sections = report.sections.length ? report.sections : [{ name: report.reportLabel, columns: [], rows: [] }]

  sections.forEach((section, si) => {
    const columns = section.columns.length ? section.columns : [{ key: '_', header: '' }]
    const nCols = Math.max(columns.length, 1)
    const widths = widthsFor({ ...section, columns })
    const ws = wb.addWorksheet(sheetName(section.name, used), {
      properties: { tabColor: { argb: tone } },
      pageSetup: {
        paperSize: 1 as any,
        orientation: nCols > 6 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
      },
    })
    ws.properties.defaultRowHeight = 18
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w
    })
    const last = colLetter(nCols)

    // ── Header band in the event's colour ──
    const totalPx = widths.reduce((a, w) => a + pxOf(w), 0)
    const logoH = 34
    const logoW = Math.round(logoH * (249 / 150))
    // Which column the wordmark starts in, so the text merges stop short of it.
    let logoCol = nCols
    let logoOffsetPx = 0
    {
      const target = Math.max(0, totalPx - logoW - 6)
      let x = 0
      for (let i = 0; i < nCols; i++) {
        const w = pxOf(widths[i])
        if (x + w > target) {
          logoCol = i
          logoOffsetPx = target - x
          break
        }
        x += w
      }
    }
    const textLast = colLetter(Math.max(1, logoCol >= 2 ? logoCol : nCols))
    const bandRows: Array<{ h: number; text?: string; font?: Partial<ExcelJS.Font>; valign?: 'top' | 'middle' | 'bottom' }> = [
      { h: 10 },
      { h: 16, text: report.reportLabel.toUpperCase(), font: { name: FONT, size: 8, bold: true, color: { argb: 'FFB8B8B8' } }, valign: 'bottom' },
      { h: 30, text: report.title, font: { name: FONT, size: 18, bold: true, color: { argb: WHITE } }, valign: 'middle' },
      ...(report.subtitle || [])
        .filter(Boolean)
        .slice(0, 3)
        .map((s) => ({ h: 16, text: s, font: { name: FONT, size: 10, color: { argb: 'FFE6E6E6' } }, valign: 'middle' as const })),
      {
        h: 18,
        text: [report.organizerName, generated].filter(Boolean).join('  ·  '),
        font: { name: FONT, size: 9, color: { argb: 'FFA9A9A9' } },
        valign: 'middle',
      },
      { h: 10 },
    ]
    bandRows.forEach((b, i) => {
      const r = ws.getRow(i + 1)
      r.height = b.h
      for (let c = 1; c <= nCols; c++) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone } }
      }
      if (b.text != null) {
        if (textLast !== 'A') ws.mergeCells(`A${i + 1}:${textLast}${i + 1}`)
        const cell = r.getCell(1)
        cell.value = safeText(b.text)
        cell.font = b.font as ExcelJS.Font
        cell.alignment = { vertical: b.valign || 'middle', horizontal: 'left', indent: 1 }
      }
    })
    ws.addImage(logoId, {
      tl: { col: logoCol + logoOffsetPx / pxOf(widths[Math.min(logoCol, nCols - 1)]), row: 1.15 } as any,
      ext: { width: logoW, height: logoH },
      editAs: 'absolute',
    })
    let rowIdx = bandRows.length + 2 // one blank row under the band

    // ── Key figures (first sheet) ──
    if (si === 0 && report.stats && report.stats.length) {
      // Label spans enough columns for ~24 characters, the value the next ~20.
      const span = (from: number, chars: number) => {
        let acc = 0
        let to = from
        for (let c = from; c <= nCols; c++) {
          acc += widths[c - 1]
          to = c
          if (acc >= chars) break
        }
        return to
      }
      const labelTo = span(1, 24)
      const valueFrom = Math.min(nCols, labelTo + 1)
      const valueTo = span(valueFrom, 22)
      for (const s of report.stats) {
        const r = ws.getRow(rowIdx)
        r.height = 20
        if (labelTo > 1) ws.mergeCells(`A${rowIdx}:${colLetter(labelTo)}${rowIdx}`)
        const l = r.getCell(1)
        l.value = safeText(s.label).toUpperCase()
        l.font = { name: FONT, size: 8, bold: true, color: { argb: MUTED } }
        l.alignment = { vertical: 'middle', indent: 1 }
        if (valueFrom > labelTo) {
          if (valueTo > valueFrom) ws.mergeCells(`${colLetter(valueFrom)}${rowIdx}:${colLetter(valueTo)}${rowIdx}`)
          const v = r.getCell(valueFrom)
          v.value = safeText(s.value)
          v.font = { name: FONT, size: 12, bold: true, color: { argb: INK } }
          v.alignment = { vertical: 'middle', horizontal: 'left' }
        }
        for (let c = 1; c <= Math.max(valueTo, labelTo); c++) {
          r.getCell(c).border = { bottom: { style: 'hair', color: { argb: RULE } } }
        }
        rowIdx++
      }
      rowIdx++
    }

    // ── Section note ──
    if (section.note) {
      ws.mergeCells(`A${rowIdx}:${last}${rowIdx}`)
      const c = ws.getRow(rowIdx).getCell(1)
      c.value = safeText(section.note)
      c.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
      c.alignment = { vertical: 'middle', indent: 1, wrapText: true }
      ws.getRow(rowIdx).height = 18
      rowIdx += 2
    }

    // ── Header row ──
    const headerRow = rowIdx
    const hr = ws.getRow(headerRow)
    hr.height = 26
    columns.forEach((col, i) => {
      const cell = hr.getCell(i + 1)
      cell.value = safeText(col.header)
      cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: WHITE } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }
      cell.alignment = {
        vertical: 'middle',
        horizontal: isNumericKind(col) ? 'right' : 'left',
        indent: isNumericKind(col) ? 0 : 1,
      }
    })
    rowIdx++

    // ── Rows ──
    const firstData = rowIdx
    if (section.rows.length === 0) {
      ws.mergeCells(`A${rowIdx}:${last}${rowIdx}`)
      const c = ws.getRow(rowIdx).getCell(1)
      c.value = report.labels.empty
      c.font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } }
      c.alignment = { vertical: 'middle', indent: 1 }
      ws.getRow(rowIdx).height = 24
      rowIdx++
    } else {
      for (const row of section.rows) {
        const r = ws.getRow(rowIdx)
        r.height = 20
        columns.forEach((col, i) => {
          const cell = r.getCell(i + 1)
          writeCell(cell, col, row[col.key], ctx)
          if (!cell.font || !(cell.value as any)?.richText) {
            cell.font = { name: FONT, size: 10, color: { argb: INK } }
          }
          cell.alignment = {
            vertical: 'middle',
            horizontal: isNumericKind(col) ? 'right' : 'left',
            indent: isNumericKind(col) ? 0 : 1,
          }
          cell.border = { bottom: { style: 'hair', color: { argb: RULE } } }
        })
        rowIdx++
      }
    }
    const lastData = rowIdx - 1

    // ── Totals ──
    const totals = sectionTotals({ ...section, columns })
    if (section.rows.length > 0 && totals.size > 0) {
      const r = ws.getRow(rowIdx)
      r.height = 24
      columns.forEach((col, i) => {
        const cell = r.getCell(i + 1)
        const t = totals.get(col.key)
        if (t) {
          const L = colLetter(i + 1)
          // Our own formula over our own range: SUBTOTAL(109) skips rows the
          // autofilter hides, so the total follows the filter.
          cell.value = { formula: `SUBTOTAL(109,${L}${firstData}:${L}${lastData})`, result: t.sum } as any
          cell.numFmt = col.kind === 'money' ? moneyFormat(t.currency) : col.kind === 'integer' ? '#,##0' : '#,##0.00'
        } else if (i === 0) {
          cell.value = report.labels.total
        }
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
        cell.border = { top: { style: 'thin', color: { argb: INK } } }
        cell.alignment = { vertical: 'middle', horizontal: t ? 'right' : 'left', indent: t ? 0 : 1 }
      })
      rowIdx++
    }

    if (section.rows.length > 0) {
      ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: nCols } }
    }
    ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0, topLeftCell: `A${headerRow + 1}`, showGridLines: false } as any]
    ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`
    ws.headerFooter.oddFooter = `&L&8${escapeHF(`${report.title} · ${generated}`)}&R&8${escapeHF(
      (report.labels.page as (n: any, t: any) => string)('§P', '§N')
    ).replace('§P', '&P').replace('§N', '&N')}`
  })

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
