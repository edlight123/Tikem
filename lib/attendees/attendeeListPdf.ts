import { jsPDF } from 'jspdf'
import { PASS_LOGO } from '@/lib/wallet/brandArt'

/**
 * The attendee list as a branded, printable PDF (owner, 2026-11-16: "a nicely
 * put pdf that can be downloaded with all the logos and event colors").
 *
 * Page: white (it gets printed for the door). Header band in the EVENT'S own
 * colour (a deep shade of the poster's average colour), with the poster, the
 * title, date · venue, and the tikèm wordmark. Then the totals, then a
 * numbered list sorted by name with a tick box per guest (a paper fallback
 * when phones die), ticket type and check-in time. No emails: this sheet is
 * meant to sit on a table at the entrance.
 */

export interface PdfAttendee {
  name: string
  tier: string
  checkedInAt: Date | null
  live: boolean
}

export interface AttendeePdfInput {
  title: string
  dateLine: string
  venueLine: string
  organizerName: string
  /** Deep header colour, '#rrggbb'. */
  tone: string
  /** JPEG bytes of the poster, already resized. */
  poster: Buffer | null
  attendees: PdfAttendee[]
  generatedLine: string
  labels: {
    tickets: string
    checkedIn: string
    name: string
    ticket: string
    in: string
    page: (n: number, total: number) => string
    notValid: string
  }
  timeOf: (d: Date) => string
}

const PAGE_W = 612 // US Letter, pt
const PAGE_H = 792
const M = 40
const INK = '#141414'
const MUTED = '#6b6b6b'
const RULE = '#e6e6e6'
const ZEBRA = '#f6f6f6'
const TEAL = '#14B8A6'

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [20, 20, 20]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function renderAttendeeListPdf(input: AttendeePdfInput): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  doc.setProperties({ title: `${input.title} – attendees`, creator: 'Tikèm' })

  const people = [...input.attendees].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const live = people.filter((p) => p.live)
  const inCount = live.filter((p) => p.checkedInAt).length

  // ── Header band in the event's colour ──
  const bandH = 168
  doc.setFillColor(...hexToRgb(input.tone))
  doc.rect(0, 0, PAGE_W, bandH, 'F')

  let textX = M
  if (input.poster) {
    try {
      const ph = bandH - 2 * 28
      const pw = ph * 0.8 // 4:5
      doc.addImage(input.poster, 'JPEG', M, 28, pw, ph, undefined, 'FAST')
      textX = M + pw + 22
    } catch {
      textX = M
    }
  }

  // Wordmark, top right (white with the teal è, same as the app).
  try {
    const props = doc.getImageProperties(PASS_LOGO.x3)
    const h = 22
    const w = (props.width / props.height) * h
    doc.addImage(PASS_LOGO.x3, 'PNG', PAGE_W - M - w, 24, w, h)
  } catch {
    // An unreadable logo never blocks the sheet.
  }

  const textW = PAGE_W - M - textX - 70
  doc.setTextColor('#ffffff')
  doc.setFont('times', 'italic')
  doc.setFontSize(28)
  const titleLines = doc.splitTextToSize(input.title, textW).slice(0, 2)
  let y = 64
  doc.text(titleLines, textX, y)
  y += titleLines.length * 30
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor('#e8e8e8')
  if (input.dateLine) {
    doc.text(input.dateLine, textX, y)
    y += 15
  }
  if (input.venueLine) {
    doc.text(doc.splitTextToSize(input.venueLine, textW)[0], textX, y)
    y += 15
  }
  if (input.organizerName) {
    doc.setTextColor('#bdbdbd')
    doc.text(input.organizerName, textX, y)
  }

  // ── Totals ──
  y = bandH + 34
  const stat = (label: string, value: string, x: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(MUTED)
    doc.text(label.toUpperCase(), x, y, { charSpace: 0.8 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(INK)
    doc.text(value, x, y + 24)
  }
  stat(input.labels.tickets, String(live.length), M)
  stat(input.labels.checkedIn, `${inCount}`, M + 150)
  // Turnout bar under the totals.
  const barY = y + 40
  doc.setFillColor(RULE)
  doc.rect(M, barY, PAGE_W - 2 * M, 3, 'F')
  if (live.length > 0 && inCount > 0) {
    doc.setFillColor(TEAL)
    doc.rect(M, barY, (PAGE_W - 2 * M) * (inCount / live.length), 3, 'F')
  }

  // ── The list ──
  const ROW = 24
  const colNum = M
  const colBox = M + 30
  const colName = M + 56
  const colTier = M + 330
  const colIn = PAGE_W - M
  let rowY = barY + 34

  const header = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(MUTED)
    doc.text('#', colNum, rowY)
    doc.text(input.labels.name.toUpperCase(), colName, rowY, { charSpace: 0.6 })
    doc.text(input.labels.ticket.toUpperCase(), colTier, rowY, { charSpace: 0.6 })
    doc.text(input.labels.in.toUpperCase(), colIn, rowY, { align: 'right', charSpace: 0.6 })
    doc.setDrawColor(RULE)
    doc.setLineWidth(0.6)
    doc.line(M, rowY + 8, PAGE_W - M, rowY + 8)
    rowY += 8
  }
  header()

  const footerY = PAGE_H - 28
  people.forEach((p, i) => {
    if (rowY + ROW > footerY - 12) {
      doc.addPage()
      rowY = M + 10
      header()
    }
    const top = rowY
    if (i % 2 === 1) {
      doc.setFillColor(ZEBRA)
      doc.rect(M, top, PAGE_W - 2 * M, ROW, 'F')
    }
    const base = top + ROW / 2 + 3.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(MUTED)
    doc.text(String(i + 1), colNum, base)
    // Tick box (filled teal check when already in).
    doc.setDrawColor('#b5b5b5')
    doc.setLineWidth(0.8)
    doc.rect(colBox, base - 8.5, 11, 11)
    if (p.checkedInAt) {
      doc.setDrawColor(TEAL)
      doc.setLineWidth(1.6)
      doc.line(colBox + 2.2, base - 3, colBox + 4.6, base - 0.4)
      doc.line(colBox + 4.6, base - 0.4, colBox + 9, base - 6.5)
    }
    doc.setFontSize(10.5)
    doc.setTextColor(p.live ? INK : '#a0a0a0')
    doc.setFont('helvetica', p.live ? 'bold' : 'normal')
    doc.text(doc.splitTextToSize(p.name || '—', colTier - colName - 12)[0], colName, base)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(MUTED)
    doc.text(doc.splitTextToSize(p.live ? p.tier : `${p.tier} · ${input.labels.notValid}`, colIn - colTier - 70)[0], colTier, base)
    if (p.checkedInAt) {
      doc.setTextColor(INK)
      doc.text(input.timeOf(p.checkedInAt), colIn, base, { align: 'right' })
    }
    rowY += ROW
  })

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages()
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor('#9a9a9a')
    doc.text(`${input.title} · ${input.generatedLine}`, M, footerY)
    doc.text(input.labels.page(n, pages), PAGE_W - M, footerY, { align: 'right' })
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
