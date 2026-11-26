/**
 * Print-ready PDF for a printed batch (Tikèm prints in-house).
 *
 * TALL stub tickets, 2.75 × 7 in (owner, 2026-11-25), in the design the
 * organizer chose and approved (lib/physical/design). Imposed on LANDSCAPE
 * Letter (3 across) or A4 (4 across), the most that fit with a printable
 * margin, with crop marks outside every ticket. Optional back pages for
 * duplex ("Comment fonctionne ce billet"), mirrored so each back lands
 * behind its front when the sheet flips on the short edge.
 *
 * Language: a Haiti event's sheet is FRENCH with the 12-hour clock; the
 * caller decides (lib/physical/design/facts ticketLang).
 *
 * The same template code draws the organizer's proof (SVG): see
 * ./design/proof.ts. What they approve is what prints.
 */

import { jsPDF } from 'jspdf'
import { PdfPainter, PT_PER_UNIT, ARTBOARD, registerTicketFonts } from './design/painter'
import { TICKET_LABELS, type TicketFacts } from './design/facts'
import { getTemplate, swatchFor, DEFAULT_TEMPLATE_ID, type BatchDesign, type Lang } from './design/registry'
import { drawBack, drawFront, type DrawContext } from './design/templates'
import type { DesignAssets } from './design/assets'

export type PaperSize = 'letter' | 'a4'
export type PdfLang = Lang

export interface PrintableTicket {
  serial: string
  qrPayload: string
  tierName: string
}

/** Every fixed word printed on the sheet, per language (kept under its old name). */
export const PDF_LABELS = TICKET_LABELS

/** Landscape pages, in points. */
export const PAGE = { letter: { w: 792, h: 612 }, a4: { w: 841.89, h: 595.28 } } as const
export const TICKET_PT = { w: ARTBOARD.w * PT_PER_UNIT, h: ARTBOARD.h * PT_PER_UNIT } // 198 × 504
/** Printers cannot print the outer ~0.25 in; crop marks live in this margin. */
const MIN_MARGIN = 18
const MAX_GUTTER = 18
const MARK = 9

/** How many tickets fit across a page, the gutter between them and where the row starts. Exported for tests. */
export function sheetLayout(paper: PaperSize) {
  const { w, h } = PAGE[paper]
  const cols = Math.max(1, Math.floor((w - 2 * MIN_MARGIN) / TICKET_PT.w))
  const spare = w - cols * TICKET_PT.w
  const gutter = cols > 1 ? Math.min(MAX_GUTTER, (spare - 2 * MIN_MARGIN) / (cols - 1)) : 0
  const x0 = (w - (cols * TICKET_PT.w + (cols - 1) * gutter)) / 2
  const y0 = (h - TICKET_PT.h) / 2
  return { cols, gutter, x0, y0 }
}

export function ticketsPerPage(paper: PaperSize): number {
  return sheetLayout(paper).cols
}
/** Kept for callers that think in the old name. */
export const TICKETS_PER_PAGE = ticketsPerPage('letter')

/** Where ticket i of a page goes (a back page mirrors the columns). Exported for tests. */
export function ticketBox(paper: PaperSize, indexOnPage: number, back = false) {
  const { cols, gutter, x0, y0 } = sheetLayout(paper)
  const col = back ? cols - 1 - indexOnPage : indexOnPage
  return { x: x0 + col * (TICKET_PT.w + gutter), y: y0, w: TICKET_PT.w, h: TICKET_PT.h }
}

function cropMarks(doc: jsPDF, b: { x: number; y: number; w: number; h: number }, outer: { left: boolean; right: boolean }) {
  doc.setDrawColor('#9A9A9A')
  doc.setLineWidth(0.35)
  doc.setLineDashPattern([], 0)
  const gap = 3
  for (const [cx, cy, dx, dy] of [
    [b.x, b.y, -1, -1],
    [b.x + b.w, b.y, 1, -1],
    [b.x, b.y + b.h, -1, 1],
    [b.x + b.w, b.y + b.h, 1, 1],
  ] as const) {
    // Vertical marks above / below the sheet row; horizontal ones only where
    // the neighbour leaves room (the outer edges).
    doc.line(cx, cy + dy * gap, cx, cy + dy * (gap + MARK))
    if ((dx < 0 && outer.left) || (dx > 0 && outer.right)) doc.line(cx + dx * gap, cy, cx + dx * (gap + MARK), cy)
  }
}

export interface RenderBatchParams {
  design: BatchDesign
  facts: TicketFacts
  tickets: PrintableTicket[]
  assets?: DesignAssets
  paper?: PaperSize
  lang?: PdfLang
  batchLabel?: string
  /** Add a back page after each front page (duplex). */
  backs?: boolean
  /** A proof sheet: marked SPÉCIMEN in the footer. */
  specimen?: boolean
}

/** The whole batch as one PDF (Uint8Array). */
export async function renderBatchPdf(params: RenderBatchParams): Promise<Uint8Array> {
  const paper: PaperSize = params.paper === 'a4' ? 'a4' : 'letter'
  const lang: Lang = params.lang && TICKET_LABELS[params.lang] ? params.lang : 'fr'
  const labels = TICKET_LABELS[lang]
  const template = getTemplate(params.design?.template) || getTemplate(DEFAULT_TEMPLATE_ID)!
  const swatch = swatchFor(template, params.design?.color)
  const doc = new jsPDF({ unit: 'pt', format: paper, orientation: 'landscape', compress: true })
  const fonts = registerTicketFonts(doc)
  const perPage = ticketsPerPage(paper)
  const pages = Math.max(1, Math.ceil(params.tickets.length / perPage))
  const { w, h } = PAGE[paper]

  const footer = (text: string) => {
    doc.setFont(fonts.sans, 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor('#5C5C5C')
    doc.text(text, w / 2, h - 10, { align: 'center' })
  }

  let first = true
  for (let pg = 0; pg < pages; pg++) {
    const slice = params.tickets.slice(pg * perPage, (pg + 1) * perPage)
    const ctxFor = (t: PrintableTicket): DrawContext => ({
      template,
      swatch,
      facts: { ...params.facts, tierName: t.tierName || params.facts.tierName },
      labels,
      ticket: t,
      photo: params.assets?.photo || null,
      logos: params.assets?.logos || [],
    })
    if (!first) doc.addPage(paper, 'landscape')
    first = false
    slice.forEach((t, i) => {
      const b = ticketBox(paper, i)
      cropMarks(doc, b, { left: i === 0, right: i === slice.length - 1 })
      drawFront(new PdfPainter(doc, fonts, b.x, b.y), ctxFor(t))
    })
    const span = slice.length ? labels.span(slice[0].serial, slice[slice.length - 1].serial) : ''
    const templateLine = `${template.name[lang]} · ${swatch.name[lang]}`
    footer(
      [params.specimen ? labels.specimen : '', params.batchLabel || '', templateLine, span, labels.page(pg + 1, pages)].filter(Boolean).join('   ')
    )
    if (params.backs) {
      doc.addPage(paper, 'landscape')
      slice.forEach((t, i) => {
        const b = ticketBox(paper, i, true)
        cropMarks(doc, b, { left: i === slice.length - 1, right: i === 0 })
        drawBack(new PdfPainter(doc, fonts, b.x, b.y), ctxFor(t))
      })
      footer([labels.duplexNote, params.batchLabel || '', span].filter(Boolean).join('   '))
    }
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
