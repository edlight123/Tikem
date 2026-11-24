/**
 * Print-ready PDF for a printed batch (Tikèm prints in-house).
 *
 * Letter or A4, 8 tickets per page (2 × 4) with crop marks in the gutters.
 * Each ticket is the brand's dark tone: black ground, the event in Instrument
 * Serif, everything else in Plus Jakarta Sans, the tier in the teal accent, and
 * a perforated stub on the right (serial + tier, kept by the seller). The QR
 * sits on a white square: a light-on-dark QR scans unreliably on phones.
 *
 * Colours come from lib/design/tokens.ts (solid steps only: PDF has no alpha
 * on the canvas the way CSS does).
 */

import fs from 'node:fs'
import path from 'node:path'
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { color } from '@/lib/design/tokens'

export type PaperSize = 'letter' | 'a4'

export interface PrintableTicket {
  serial: string
  qrPayload: string
  tierName: string
}

export interface PrintableEvent {
  title: string
  dateLine: string
  venueLine: string
  organizerName?: string | null
}

const PAGE = { letter: { w: 612, h: 792 }, a4: { w: 595.28, h: 841.89 } } as const
const COLS = 2
const ROWS = 4
export const TICKETS_PER_PAGE = COLS * ROWS
const MARGIN = 30
const GUTTER = 18
const MARK = 8

const INK = {
  ground: color.canvas,
  panel: color.surface.solid,
  line: color.line.solid,
  text: color.fg.DEFAULT,
  muted: color.fg['muted-solid'],
  accent: color.brand[400],
  paper: color.inverse.DEFAULT,
  mark: color.fg['muted-solid'],
  qrDark: color.shade,
}

let fontCache: Record<string, string> | null = null
function fonts(): Record<string, string> {
  if (fontCache) return fontCache
  const dir = path.join(process.cwd(), 'assets', 'fonts')
  const read = (f: string) => {
    try {
      return fs.readFileSync(path.join(dir, f)).toString('base64')
    } catch {
      return ''
    }
  }
  fontCache = {
    serif: read('InstrumentSerif-Regular.ttf'),
    sans: read('PlusJakartaSans-Regular.ttf'),
    sansBold: read('PlusJakartaSans-SemiBold.ttf'),
  }
  return fontCache
}

function registerFonts(doc: jsPDF): { serif: string; sans: string; sansBold: string } {
  const f = fonts()
  const out = { serif: 'times', sans: 'helvetica', sansBold: 'helvetica' }
  if (f.serif) {
    doc.addFileToVFS('InstrumentSerif-Regular.ttf', f.serif)
    doc.addFont('InstrumentSerif-Regular.ttf', 'InstrumentSerif', 'normal')
    out.serif = 'InstrumentSerif'
  }
  if (f.sans) {
    doc.addFileToVFS('PlusJakartaSans-Regular.ttf', f.sans)
    doc.addFont('PlusJakartaSans-Regular.ttf', 'PlusJakartaSans', 'normal')
    out.sans = 'PlusJakartaSans'
  }
  if (f.sansBold) {
    doc.addFileToVFS('PlusJakartaSans-SemiBold.ttf', f.sansBold)
    doc.addFont('PlusJakartaSans-SemiBold.ttf', 'PlusJakartaSansSemiBold', 'normal')
    out.sansBold = 'PlusJakartaSansSemiBold'
  }
  return out
}

/** Grid geometry: where ticket i of a page goes. Exported for tests. */
export function ticketBox(paper: PaperSize, indexOnPage: number) {
  const { w, h } = PAGE[paper]
  const tw = (w - 2 * MARGIN - (COLS - 1) * GUTTER) / COLS
  const th = (h - 2 * MARGIN - (ROWS - 1) * GUTTER) / ROWS
  const col = indexOnPage % COLS
  const row = Math.floor(indexOnPage / COLS)
  return { x: MARGIN + col * (tw + GUTTER), y: MARGIN + row * (th + GUTTER), w: tw, h: th }
}

function cropMarks(doc: jsPDF, b: { x: number; y: number; w: number; h: number }) {
  doc.setDrawColor(INK.mark)
  doc.setLineWidth(0.4)
  const gap = 3
  for (const [cx, cy, dx, dy] of [
    [b.x, b.y, -1, -1],
    [b.x + b.w, b.y, 1, -1],
    [b.x, b.y + b.h, -1, 1],
    [b.x + b.w, b.y + b.h, 1, 1],
  ] as const) {
    doc.line(cx + dx * gap, cy, cx + dx * (gap + MARK), cy)
    doc.line(cx, cy + dy * gap, cx, cy + dy * (gap + MARK))
  }
}

function fit(doc: jsPDF, text: string, maxWidth: number, maxLines: number): string[] {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth) as string[]
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > maxWidth) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.trimEnd()}…`
  return kept
}

async function qrPng(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 360,
    color: { dark: INK.qrDark, light: INK.paper },
  })
}

function drawTicket(
  doc: jsPDF,
  f: { serif: string; sans: string; sansBold: string },
  b: { x: number; y: number; w: number; h: number },
  ev: PrintableEvent,
  t: PrintableTicket,
  qr: string
) {
  const stubW = 46
  const pad = 14
  const mainW = b.w - stubW
  const left = b.x + pad
  const right = b.x + mainW - pad
  // Ground + stub panel (a brightness step, not a border).
  doc.setFillColor(INK.ground)
  doc.rect(b.x, b.y, b.w, b.h, 'F')
  doc.setFillColor(INK.panel)
  doc.rect(b.x + mainW, b.y, stubW, b.h, 'F')
  // Perforation between ticket and stub.
  doc.setDrawColor(INK.line)
  doc.setLineWidth(0.8)
  doc.setLineDashPattern([2, 2.5], 0)
  doc.line(b.x + mainW, b.y + 6, b.x + mainW, b.y + b.h - 6)
  doc.setLineDashPattern([], 0)

  // Top: eyebrow, then the event across the full width (serif display).
  let y = b.y + pad + 6
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(INK.muted)
  doc.text('TIKÈM  ·  ADMIT ONE', left, y, { charSpace: 0.8 })
  y += 19
  doc.setFont(f.serif, 'normal')
  doc.setFontSize(18)
  doc.setTextColor(INK.text)
  const title = fit(doc, ev.title, right - left, 2)
  doc.text(title, left, y, { lineHeightFactor: 1.0 })

  // Bottom: QR on white at the right, details at the left.
  const q = Math.min(66, b.h * 0.4)
  const foot = b.y + b.h - pad
  const qx = right - q
  const qy = foot - q - 8
  doc.setFillColor(INK.paper)
  doc.roundedRect(qx - 3, qy - 3, q + 6, q + 6, 4, 4, 'F')
  doc.addImage(qr, 'PNG', qx, qy, q, q)
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(5.6)
  doc.setTextColor(INK.muted)
  doc.text('Valid only once sold', qx + q / 2, foot + 2, { align: 'center' })

  const textW = qx - 3 - left - 8
  let dy = qy + 4
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(INK.muted)
  for (const line of [ev.dateLine, ev.venueLine].filter(Boolean)) {
    const lines = fit(doc, line, textW, 2)
    doc.text(lines, left, dy, { lineHeightFactor: 1.2 })
    dy += lines.length * 9 + 2
  }
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(INK.accent)
  doc.text(fit(doc, t.tierName.toUpperCase(), textW, 1), left, foot - 12, { charSpace: 0.6 })
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(INK.text)
  doc.text(t.serial, left, foot)

  // Stub: "STUB" on top, the serial reading bottom-to-top, the tier at the foot.
  const sx = b.x + mainW + stubW / 2
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(6)
  doc.setTextColor(INK.muted)
  doc.text('STUB', sx, b.y + pad + 4, { align: 'center', charSpace: 0.8 })
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(INK.text)
  const sw = doc.getTextWidth(t.serial)
  doc.text(t.serial, sx + 3, b.y + b.h / 2 + sw / 2, { angle: 90 })
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(INK.accent)
  doc.text(fit(doc, t.tierName.toUpperCase(), stubW - 10, 1), sx, foot, { align: 'center' })
}

/** The whole batch as one PDF (Uint8Array). */
export async function renderBatchPdf(params: {
  event: PrintableEvent
  tickets: PrintableTicket[]
  paper?: PaperSize
  batchLabel?: string
}): Promise<Uint8Array> {
  const paper: PaperSize = params.paper === 'a4' ? 'a4' : 'letter'
  const doc = new jsPDF({ unit: 'pt', format: paper, compress: true })
  const f = registerFonts(doc)
  const pages = Math.max(1, Math.ceil(params.tickets.length / TICKETS_PER_PAGE))
  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage(paper)
    const slice = params.tickets.slice(p * TICKETS_PER_PAGE, (p + 1) * TICKETS_PER_PAGE)
    for (let i = 0; i < slice.length; i++) {
      const b = ticketBox(paper, i)
      cropMarks(doc, b)
      drawTicket(doc, f, b, params.event, slice[i], await qrPng(slice[i].qrPayload))
    }
    // Page footer for the print room: batch, page, serial span.
    const { w, h } = PAGE[paper]
    doc.setFont(f.sans, 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(INK.mark)
    const span = slice.length ? `${slice[0].serial} to ${slice[slice.length - 1].serial}` : ''
    doc.text(`${params.batchLabel || ''}   ${span}   page ${p + 1} of ${pages}`.trim(), w / 2, h - 12, { align: 'center' })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
