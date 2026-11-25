import { jsPDF } from 'jspdf'
import { PASS_LOGO } from '@/lib/wallet/brandArt'
import {
  TONE_HEX,
  currencyOf,
  isNumericKind,
  isStatus,
  safeText,
  sectionTotals,
  toDateValue,
  toNumber,
  widthHint,
} from './cells'
import type { CellValue, ExportColumn, ExportReport } from './types'
import { haitiHourOptions, isHaitiZone } from '@/lib/datetime/eventClock'

/**
 * An ExportReport as a printable PDF, in the family of the attendee door
 * sheet (lib/attendees/attendeeListPdf): white page, a header band in the
 * event's colour with the poster and the tikèm wordmark, the key figures,
 * then one clean table per section (zebra rows, right-aligned figures,
 * status as a dot + label, a ruled totals row). Continuation pages get a slim
 * band and the table header again; every page is numbered.
 *
 * Landscape when the table is wide. jsPDF's built-in Helvetica covers
 * Latin-1 (è, ò, é, à…), which is every name Kreyòl and French produce.
 */

const INK = '#141414'
const MUTED = '#6b6b6b'
const FAINT = '#9a9a9a'
const RULE = '#e4e4e4'
const ZEBRA = '#f6f6f6'

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [20, 20, 20]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Helvetica (WinAnsi) has no narrow no-break space; Intl uses it in fr. */
function pdfText(s: string): string {
  return safeText(s).replace(/[   ]/g, ' ').replace(/ /g, ' ')
}

export function renderReportPdf(report: ExportReport): Uint8Array {
  const widest = Math.max(
    0,
    ...report.sections.map((s) => s.columns.filter((c) => c.pdf !== false).reduce((a, c) => a + widthHint(c), 0))
  )
  const landscape = widest > 96 || report.sections.some((s) => s.columns.filter((c) => c.pdf !== false).length > 6)
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: landscape ? 'landscape' : 'portrait', compress: true })
  doc.setProperties({ title: `${report.title} – ${report.reportLabel}`, subject: report.reportLabel, creator: 'Tikèm', author: 'Tikèm' })

  const PAGE_W = doc.internal.pageSize.getWidth()
  const PAGE_H = doc.internal.pageSize.getHeight()
  const M = 36
  const CONTENT_W = PAGE_W - 2 * M
  const footerY = PAGE_H - 24
  const tone = report.tone || INK
  const now = report.generatedAt || new Date()

  const fmtDate = (d: Date, withTime: boolean) => {
    const o: Intl.DateTimeFormatOptions = withTime
      ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', ...haitiHourOptions(isHaitiZone(report.timeZone)) }
      : { day: 'numeric', month: 'short', year: 'numeric' }
    try {
      return pdfText(new Intl.DateTimeFormat(report.locale, { timeZone: report.timeZone, ...o }).format(d))
    } catch {
      return d.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' ')
    }
  }
  const fmtNum = (n: number, digits: number) => {
    try {
      return pdfText(new Intl.NumberFormat(report.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n))
    } catch {
      return n.toFixed(digits)
    }
  }
  const generated = `${report.labels.generated} ${fmtDate(now, true)}`

  const drawLogo = (h: number, rightX: number, topY: number) => {
    try {
      const props = doc.getImageProperties(PASS_LOGO.x3)
      const w = (props.width / props.height) * h
      doc.addImage(PASS_LOGO.x3, 'PNG', rightX - w, topY, w, h)
    } catch {
      // An unreadable logo never blocks the report.
    }
  }

  /** The longest prefix of `text` that fits `w`, with an ellipsis when cut. */
  const fit = (text: string, w: number) => {
    const t = pdfText(text)
    if (doc.getTextWidth(t) <= w) return t
    let lo = 0
    let hi = t.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (doc.getTextWidth(`${t.slice(0, mid).trimEnd()}…`) <= w) lo = mid
      else hi = mid - 1
    }
    return lo > 0 ? `${t.slice(0, lo).trimEnd()}…` : ''
  }

  // ── First-page header band ──
  const subtitle = (report.subtitle || []).filter(Boolean).slice(0, 3)
  const bandH = Math.max(report.poster ? 150 : 128, 92 + subtitle.length * 14)
  doc.setFillColor(...hexToRgb(tone))
  doc.rect(0, 0, PAGE_W, bandH, 'F')
  let textX = M
  if (report.poster) {
    try {
      const ph = bandH - 2 * 24
      const pw = ph * 0.8
      doc.addImage(report.poster, 'JPEG', M, 24, pw, ph, undefined, 'FAST')
      textX = M + pw + 22
    } catch {
      textX = M
    }
  }
  drawLogo(22, PAGE_W - M, 24)
  const textW = PAGE_W - M - textX - 80
  let y = 40
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor('#bdbdbd')
  doc.text(pdfText(report.reportLabel.toUpperCase()), textX, y, { charSpace: 1.2 })
  y += 28
  doc.setTextColor('#ffffff')
  doc.setFont('times', 'italic')
  doc.setFontSize(26)
  const titleLines = (doc.splitTextToSize(pdfText(report.title), textW) as string[]).slice(0, 2)
  doc.text(titleLines, textX, y)
  y += (titleLines.length - 1) * 27 + 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor('#e8e8e8')
  for (const line of subtitle) {
    doc.text(fit(line, textW), textX, y)
    y += 14
  }
  if (report.organizerName) {
    doc.setTextColor('#b0b0b0')
    doc.text(fit(report.organizerName, textW), textX, y)
  }

  y = bandH + 30

  // ── Key figures ──
  const stats = (report.stats || []).slice(0, 6)
  if (stats.length) {
    const per = Math.min(170, CONTENT_W / stats.length)
    stats.forEach((s, i) => {
      const x = M + i * per
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(MUTED)
      doc.text(fit(s.label.toUpperCase(), per - 14), x, y, { charSpace: 0.8 })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(17)
      doc.setTextColor(INK)
      doc.text(fit(s.value, per - 14), x, y + 22)
    })
    y += 44
    doc.setDrawColor(RULE)
    doc.setLineWidth(0.6)
    doc.line(M, y, PAGE_W - M, y)
    y += 26
  }

  // ── Continuation pages ──
  const newPage = () => {
    doc.addPage()
    const h = 34
    doc.setFillColor(...hexToRgb(tone))
    doc.rect(0, 0, PAGE_W, h, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor('#ffffff')
    doc.text(fit(`${report.title}`, CONTENT_W - 220), M, 21)
    drawLogo(14, PAGE_W - M, 10)
    return h + 28
  }

  const ROW = 19
  const PAD = 6

  for (const section of report.sections) {
    const cols = section.columns.filter((c) => c.pdf !== false)
    if (!cols.length) continue
    const FS = cols.length > 8 ? 7.8 : 8.5

    // A money column whose rows share one currency names it once, in the
    // header ("GROSS · HTG"), and its cells show figures only.
    const oneCurrency = new Map<string, string>()
    for (const c of cols) {
      if (c.kind !== 'money') continue
      const set = new Set<string>()
      for (const r of section.rows) if (toNumber(r[c.key]) != null) set.add(currencyOf(c, r[c.key]))
      if (set.size === 1) oneCurrency.set(c.key, Array.from(set)[0])
      else if (set.size === 0 && c.currency) oneCurrency.set(c.key, c.currency.toUpperCase())
    }
    const headerOf = (c: ExportColumn) => {
      const cur = oneCurrency.get(c.key)
      return cur && !c.header.toUpperCase().includes(cur) ? `${c.header} · ${cur}` : c.header
    }

    const cellText = (c: ExportColumn, v: CellValue): string => {
      if (v == null || v === '') return ''
      if (isStatus(v)) return v.label
      switch (c.kind) {
        case 'money': {
          const n = toNumber(v)
          if (n == null) return safeText(v)
          if (oneCurrency.has(c.key)) return fmtNum(n, 2)
          const cur = currencyOf(c, v)
          return cur ? `${fmtNum(n, 2)} ${cur}` : fmtNum(n, 2)
        }
        case 'number': {
          const n = toNumber(v)
          return n == null ? safeText(v) : fmtNum(n, 2)
        }
        case 'integer': {
          const n = toNumber(v)
          return n == null ? safeText(v) : fmtNum(n, 0)
        }
        case 'percent': {
          const n = toNumber(v)
          return n == null ? safeText(v) : `${fmtNum(n * 100, 1)}%`
        }
        case 'date':
        case 'datetime': {
          const d = toDateValue(v)
          return d ? fmtDate(d, c.kind === 'datetime') : safeText(v)
        }
        default:
          return typeof v === 'boolean' ? (v ? 'Yes' : '') : safeText(v instanceof Date ? v.toISOString() : v)
      }
    }
    const boldCol = (c: ExportColumn, i: number) => i === 0 && (c.kind || 'text') === 'text'

    // ── Column widths from the content itself ──
    // Each column wants its widest cell (a sample) and its longest header
    // word; figures, dates and states keep that width, free text gives way.
    const totals = sectionTotals(section)
    const sample = section.rows.slice(0, 400)
    const want = cols.map((c, i) => {
      doc.setFontSize(FS)
      let w = 0
      for (const r of sample) {
        doc.setFont('helvetica', boldCol(c, i) ? 'bold' : 'normal')
        const t = cellText(c, r[c.key])
        if (t) w = Math.max(w, doc.getTextWidth(pdfText(t)) + (c.kind === 'status' || isStatus(r[c.key]) ? 10 : 0))
      }
      const t = totals.get(c.key)
      if (t) {
        doc.setFont('helvetica', 'bold')
        w = Math.max(w, doc.getTextWidth(fmtNum(t.sum, c.kind === 'integer' ? 0 : 2)) + 4)
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      const words = pdfText(headerOf(c).toUpperCase()).split(/\s+/)
      const headWord = Math.max(...words.map((wd) => doc.getTextWidth(wd) + wd.length * 0.5))
      return Math.max(w, headWord, 24) + 2 * PAD
    })
    const flexible = cols.map((c) => (c.kind || 'text') === 'text')
    let widths = [...want]
    const total = widths.reduce((a, b) => a + b, 0)
    if (total < CONTENT_W) {
      // Spare room goes to the text columns (or everyone, if there are none).
      const pool = flexible.some(Boolean) ? flexible : cols.map(() => true)
      const share = widths.reduce((a, w, i) => a + (pool[i] ? w : 0), 0)
      widths = widths.map((w, i) => (pool[i] ? w + ((CONTENT_W - total) * w) / share : w))
    } else if (total > CONTENT_W) {
      const fixed = widths.reduce((a, w, i) => a + (flexible[i] ? 0 : w), 0)
      const flexW = widths.reduce((a, w, i) => a + (flexible[i] ? w : 0), 0)
      const room = CONTENT_W - fixed
      if (flexW > 0 && room >= flexible.filter(Boolean).length * 48) {
        widths = widths.map((w, i) => (flexible[i] ? (w / flexW) * room : w))
      } else {
        widths = widths.map((w) => (w / total) * CONTENT_W)
      }
    }
    const xs: number[] = []
    widths.reduce((x, w, i) => ((xs[i] = x), x + w), M)

    // Section heading: editorial serif, lowercased (the app's section rail).
    if (y + 80 > footerY - 12) y = newPage()
    doc.setFont('times', 'italic')
    doc.setFontSize(16)
    doc.setTextColor(INK)
    doc.text(pdfText(section.name.toLowerCase()), M, y)
    y += 8
    if (section.note) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(MUTED)
      const lines = (doc.splitTextToSize(pdfText(section.note), CONTENT_W) as string[]).slice(0, 3)
      y += 12
      doc.text(lines, M, y)
      y += (lines.length - 1) * 11
    }
    y += 18

    // Headers wrap (up to three lines) rather than being cut.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    const headLines = cols.map((c, i) =>
      (doc.splitTextToSize(pdfText(headerOf(c).toUpperCase()), widths[i] - 2 * PAD - 2) as string[]).slice(0, 3)
    )
    const headH = (Math.max(...headLines.map((l) => l.length)) - 1) * 9
    const header = () => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(MUTED)
      cols.forEach((c, i) => {
        const lines = headLines[i].map((l) => fit(l, widths[i] - 2 * PAD))
        // Bottom-align: a one-line header sits on the same baseline as the
        // second line of a two-line one.
        const top = y + headH - (lines.length - 1) * 9
        lines.forEach((line, k) => {
          if (isNumericKind(c)) doc.text(line, xs[i] + widths[i] - PAD, top + k * 9, { align: 'right', charSpace: 0.5 })
          else doc.text(line, xs[i] + PAD, top + k * 9, { charSpace: 0.5 })
        })
      })
      y += headH
      doc.setDrawColor(INK)
      doc.setLineWidth(0.8)
      doc.line(M, y + 7, PAGE_W - M, y + 7)
      y += 7
    }
    header()

    if (section.rows.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9.5)
      doc.setTextColor(MUTED)
      doc.text(pdfText(report.labels.empty), M + PAD, y + 20)
      y += 30
    }

    section.rows.forEach((row, ri) => {
      if (y + ROW > footerY - 14) {
        y = newPage()
        header()
      }
      const top = y
      if (ri % 2 === 1) {
        doc.setFillColor(ZEBRA)
        doc.rect(M, top, CONTENT_W, ROW, 'F')
      }
      const base = top + ROW / 2 + 3.2
      cols.forEach((c, i) => {
        const v = row[c.key]
        const w = widths[i] - 2 * PAD
        if (isStatus(v) || c.kind === 'status') {
          const tone = isStatus(v) ? v.tone : 'neutral'
          const label = cellText(c, v)
          if (!label) return
          doc.setFillColor(TONE_HEX[tone])
          doc.circle(xs[i] + PAD + 2.5, base - 2.9, 2.5, 'F')
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(FS)
          doc.setTextColor(INK)
          doc.text(fit(label, w - 10), xs[i] + PAD + 9, base)
          return
        }
        const text = cellText(c, v)
        if (!text) return
        const numeric = isNumericKind(c)
        doc.setFont('helvetica', boldCol(c, i) ? 'bold' : 'normal')
        doc.setFontSize(FS)
        doc.setTextColor(i === 0 || numeric ? INK : '#3a3a3a')
        if (numeric) doc.text(fit(text, w), xs[i] + widths[i] - PAD, base, { align: 'right' })
        else doc.text(fit(text, w), xs[i] + PAD, base)
      })
      y += ROW
    })

    // Totals row.
    if (section.rows.length > 0 && totals.size > 0) {
      if (y + ROW + 4 > footerY - 14) {
        y = newPage()
        header()
      }
      doc.setDrawColor(INK)
      doc.setLineWidth(0.8)
      doc.line(M, y, PAGE_W - M, y)
      const base = y + ROW / 2 + 4.5
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(INK)
      let labelled = false
      cols.forEach((c, i) => {
        const t = totals.get(c.key)
        if (t) {
          const text =
            c.kind === 'money'
              ? `${fmtNum(t.sum, 2)}${t.currency && !oneCurrency.has(c.key) ? ` ${t.currency}` : ''}`
              : c.kind === 'integer'
                ? fmtNum(t.sum, 0)
                : fmtNum(t.sum, 2)
          doc.text(fit(text, widths[i] - 2 * PAD), xs[i] + widths[i] - PAD, base, { align: 'right' })
        } else if (!labelled) {
          doc.text(pdfText(report.labels.total.toUpperCase()), xs[i] + PAD, base, { charSpace: 0.6 })
          labelled = true
        }
      })
      y += ROW + 6
    }
    y += 30
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages()
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(FAINT)
    doc.text(fit(`${report.title} · ${report.reportLabel} · ${generated}`, CONTENT_W - 90), M, footerY)
    doc.text(pdfText(report.labels.page(n, pages)), PAGE_W - M, footerY, { align: 'right' })
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
