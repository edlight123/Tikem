/**
 * Print-ready PDF for a printed batch (Tikèm prints in-house).
 *
 * Letter or A4, 8 tickets per page (2 × 4) with crop marks in the gutters.
 *
 * WHITE paper, black ink (owner, 2026-11-24): solid black grounds are
 * ink-heavy and print streaky on cybercafé printers. Each ticket is white with
 * black text, the event in Instrument Serif, everything else in Plus Jakarta
 * Sans, one thin teal accent (a hairline rule on the left edge, the eyebrow and
 * the tier), a light grey dashed divider before the stub (serial + tier, kept
 * by the seller), light grey crop marks, and a black-on-white QR with its
 * quiet zone.
 *
 * Language: a Haiti event's sheet is FRENCH (owner, 2026-11-25), its date
 * line "samedi 21 juin 2026 · 8:00 PM" (12-hour clock, see
 * lib/datetime/eventClock). The route picks the language; every fixed label
 * on the ticket comes from PDF_LABELS below.
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

export type PdfLang = 'en' | 'fr' | 'ht'

/** Every fixed word printed on the sheet, per language. Exported for tests. */
export const PDF_LABELS: Record<
  PdfLang,
  { eyebrow: string; validOnceSold: string; stub: string; span: (a: string, b: string) => string; page: (n: number, of: number) => string }
> = {
  en: {
    eyebrow: 'TIKÈM  ·  ADMIT ONE',
    validOnceSold: 'Valid only once sold',
    stub: 'STUB',
    span: (a, b) => `${a} to ${b}`,
    page: (n, of) => `page ${n} of ${of}`,
  },
  fr: {
    eyebrow: 'TIKÈM  ·  ENTRÉE',
    validOnceSold: 'Valide une fois vendu',
    stub: 'TALON',
    span: (a, b) => `${a} à ${b}`,
    page: (n, of) => `page ${n} sur ${of}`,
  },
  ht: {
    eyebrow: 'TIKÈM  ·  ANTRE',
    validOnceSold: 'Valab sèlman lè l vann',
    stub: 'SOUCH',
    span: (a, b) => `${a} rive ${b}`,
    page: (n, of) => `paj ${n} sou ${of}`,
  },
}

const PAGE = { letter: { w: 612, h: 792 }, a4: { w: 595.28, h: 841.89 } } as const
const COLS = 2
const ROWS = 4
export const TICKETS_PER_PAGE = COLS * ROWS
const MARGIN = 30
const GUTTER = 18
const MARK = 8

const INK = {
  paper: color.inverse.DEFAULT, // white
  text: color.shade, // black
  secondary: color.line.solid, // near-black, for the smaller lines
  accent: color.brand[700], // brand teal, dark enough for cheap printers
  hairline: color.fg['muted-solid'], // light grey: divider, crop marks
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
  doc.setDrawColor(INK.hairline)
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
    margin: 2,
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
  qr: string,
  L: (typeof PDF_LABELS)[PdfLang]
) {
  const stubW = 46
  const pad = 14
  const mainW = b.w - stubW
  const left = b.x + pad
  const right = b.x + mainW - pad
  // White paper: no fill at all. One thin teal accent on the left edge.
  doc.setFillColor(INK.accent)
  doc.rect(b.x, b.y, 1.6, b.h, 'F')
  // Light grey dashed divider before the stub (fold / tear line).
  doc.setDrawColor(INK.hairline)
  doc.setLineWidth(0.5)
  doc.setLineDashPattern([2, 2.5], 0)
  doc.line(b.x + mainW, b.y + 6, b.x + mainW, b.y + b.h - 6)
  doc.setLineDashPattern([], 0)

  // Top: eyebrow, then the event across the full width (serif display).
  let y = b.y + pad + 6
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(INK.accent)
  doc.text(L.eyebrow, left, y, { charSpace: 0.8 })
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
  // The PNG carries its own white quiet zone (margin 2 modules).
  doc.addImage(qr, 'PNG', qx, qy, q, q)
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(5.6)
  doc.setTextColor(INK.secondary)
  doc.text(L.validOnceSold, qx + q / 2, foot + 2, { align: 'center' })

  const textW = qx - 3 - left - 8
  let dy = qy + 4
  doc.setFont(f.sans, 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(INK.secondary)
  for (const line of [ev.dateLine, ev.venueLine].filter(Boolean)) {
    // A long date ("samedi 26 septembre 2026 · 11:45 PM") breaks at its " · ",
    // date then time, instead of leaving the dot dangling at a line end.
    const lines =
      line.includes(' · ') && doc.getTextWidth(line) > textW
        ? line.split(' · ').flatMap((part) => fit(doc, part, textW, 1)).slice(0, 2)
        : fit(doc, line, textW, 2)
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

  // Stub: "STUB" / "TALON" on top, the serial reading bottom-to-top, the tier at the foot.
  const sx = b.x + mainW + stubW / 2
  doc.setFont(f.sansBold, 'normal')
  doc.setFontSize(6)
  doc.setTextColor(INK.secondary)
  doc.text(L.stub, sx, b.y + pad + 4, { align: 'center', charSpace: 0.8 })
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
  /** The sheet's language; Haiti events are always 'fr'. Defaults to 'fr'. */
  lang?: PdfLang
}): Promise<Uint8Array> {
  const paper: PaperSize = params.paper === 'a4' ? 'a4' : 'letter'
  const L = PDF_LABELS[params.lang && PDF_LABELS[params.lang] ? params.lang : 'fr']
  const doc = new jsPDF({ unit: 'pt', format: paper, compress: true })
  const f = registerFonts(doc)
  const pages = Math.max(1, Math.ceil(params.tickets.length / TICKETS_PER_PAGE))
  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage(paper)
    const slice = params.tickets.slice(p * TICKETS_PER_PAGE, (p + 1) * TICKETS_PER_PAGE)
    for (let i = 0; i < slice.length; i++) {
      const b = ticketBox(paper, i)
      cropMarks(doc, b)
      drawTicket(doc, f, b, params.event, slice[i], await qrPng(slice[i].qrPayload), L)
    }
    // Page footer for the print room: batch, page, serial span.
    const { w, h } = PAGE[paper]
    doc.setFont(f.sans, 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(INK.secondary)
    const span = slice.length ? L.span(slice[0].serial, slice[slice.length - 1].serial) : ''
    doc.text(`${params.batchLabel || ''}   ${span}   ${L.page(p + 1, pages)}`.trim(), w / 2, h - 12, { align: 'center' })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
