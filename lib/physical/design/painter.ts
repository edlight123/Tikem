/**
 * One drawing surface, two outputs: the ticket templates (./templates.ts) draw
 * through a Painter, and the SAME calls produce the print PDF (jsPDF) and the
 * organizer's proof (SVG). So the proof an organizer approves is the sheet the
 * print room prints, not a look-alike.
 *
 * Units: the 528 × 1344 artboard of the approved designs (192 per inch; a
 * ticket is 2.75 × 7 in). Each painter scales to its output. Text is measured
 * with jsPDF and the same TTFs in both (the web serves them to the proof page
 * from /api/physical/fonts), so line breaks and fits agree.
 *
 * Server only (fs).
 */

import fs from 'node:fs'
import path from 'node:path'
import { jsPDF } from 'jspdf'

export const ARTBOARD = { w: 528, h: 1344 } as const
/** PDF points per artboard unit: 2.75 in × 72 / 528. */
export const PT_PER_UNIT = 0.375

export type FontKey = 'anton' | 'serif' | 'serifItalic' | 'sans' | 'sansBold'

/** The TTF behind each font key (assets/fonts). Exported for the font route. */
export const FONT_FILES: Record<FontKey, string> = {
  anton: 'Anton-Regular.ttf',
  serif: 'InstrumentSerif-Regular.ttf',
  serifItalic: 'InstrumentSerif-Italic.ttf',
  sans: 'PlusJakartaSans-Regular.ttf',
  sansBold: 'PlusJakartaSans-SemiBold.ttf',
}
/** The CSS family the proof SVG names; the proof page declares them with @font-face. */
export const SVG_FAMILY: Record<FontKey, string> = {
  anton: "TkAnton, Impact, 'Arial Narrow', sans-serif",
  serif: "TkSerif, Georgia, serif",
  serifItalic: "TkSerifItalic, Georgia, serif",
  sans: "TkSans, system-ui, sans-serif",
  sansBold: "TkSansBold, system-ui, sans-serif",
}
const PDF_FALLBACK: Record<FontKey, string> = { anton: 'helvetica', serif: 'times', serifItalic: 'times', sans: 'helvetica', sansBold: 'helvetica' }

let fontCache: Partial<Record<FontKey, string>> | null = null
function fontData(): Partial<Record<FontKey, string>> {
  if (fontCache) return fontCache
  const dir = path.join(process.cwd(), 'assets', 'fonts')
  const out: Partial<Record<FontKey, string>> = {}
  for (const [key, file] of Object.entries(FONT_FILES) as Array<[FontKey, string]>) {
    try {
      out[key] = fs.readFileSync(path.join(dir, file)).toString('base64')
    } catch {
      // A missing font falls back to a core PDF font: still printable.
    }
  }
  fontCache = out
  return out
}

/** Register the ticket fonts on a jsPDF document; returns the family name per key. */
export function registerTicketFonts(doc: jsPDF): Record<FontKey, string> {
  const data = fontData()
  const names = { ...PDF_FALLBACK }
  for (const key of Object.keys(FONT_FILES) as FontKey[]) {
    const b64 = data[key]
    if (!b64) continue
    const family = `Tk_${key}`
    doc.addFileToVFS(FONT_FILES[key], b64)
    doc.addFont(FONT_FILES[key], family, 'normal')
    names[key] = family
  }
  return names
}

export interface Stroke {
  stroke: string
  lw: number
  dash?: number[]
  cap?: 'butt' | 'round'
}
export interface Fill {
  fill: string
}
export type Style = Partial<Stroke> & Partial<Fill>

export interface TextOpts {
  font: FontKey
  size: number
  color: string
  align?: 'left' | 'center' | 'right'
  /** Extra space after each character, artboard units. */
  charSpace?: number
  /** Degrees counter-clockwise (jsPDF convention). */
  angle?: number
}

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']

export interface PainterImage {
  /** Same key = same bytes: embedded once per document. */
  key: string
  data: Uint8Array
  format: 'PNG' | 'JPEG'
}

export interface Painter {
  readonly kind: 'pdf' | 'svg'
  rect(x: number, y: number, w: number, h: number, style: Style): void
  line(x1: number, y1: number, x2: number, y2: number, style: Stroke): void
  circle(cx: number, cy: number, r: number, style: Style): void
  path(cmds: PathCmd[], style: Style): void
  text(str: string, x: number, y: number, opts: TextOpts): void
  /** Width of `str` in artboard units (charSpace included). */
  measure(str: string, font: FontKey, size: number, charSpace?: number): number
  image(img: PainterImage, x: number, y: number, w: number, h: number): void
  /** Dark modules of a QR (row-major booleans) as filled squares. */
  qr(modules: { size: number; get: (r: number, c: number) => boolean }, x: number, y: number, side: number, color: string): void
  /**
   * A die-cut (the perforation notches): cut out of the proof, a light dashed
   * cutting guide on the print sheet.
   */
  cutout(cmds: PathCmd[]): void
}

/** Light grey: a cutting guide must not read as part of the design. */
const CUT_GUIDE = '#B5B5B5'

// ── measuring (shared) ───────────────────────────────────────────────────────

let measureDoc: { doc: jsPDF; fonts: Record<FontKey, string> } | null = null
function measurer() {
  if (!measureDoc) {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    measureDoc = { doc, fonts: registerTicketFonts(doc) }
  }
  return measureDoc
}

function measureWith(doc: jsPDF, fonts: Record<FontKey, string>, str: string, font: FontKey, size: number, charSpace = 0): number {
  const prevFont = doc.getFont()
  const prevSize = doc.getFontSize()
  doc.setFont(fonts[font], 'normal')
  doc.setFontSize(size)
  const w = doc.getTextWidth(String(str ?? ''))
  doc.setFont(prevFont.fontName, prevFont.fontStyle)
  doc.setFontSize(prevSize)
  return w + charSpace * Array.from(String(str ?? '')).length
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export class PdfPainter implements Painter {
  readonly kind = 'pdf' as const
  constructor(
    private doc: jsPDF,
    private fonts: Record<FontKey, string>,
    private ox: number,
    private oy: number,
    private s: number = PT_PER_UNIT
  ) {}

  private X = (x: number) => this.ox + x * this.s
  private Y = (y: number) => this.oy + y * this.s

  private applyStroke(st: Partial<Stroke>) {
    if (!st.stroke) return
    this.doc.setDrawColor(st.stroke)
    this.doc.setLineWidth((st.lw ?? 1) * this.s)
    this.doc.setLineDashPattern(st.dash ? st.dash.map((d) => d * this.s) : [], 0)
    this.doc.setLineCap(st.cap === 'round' ? 'round' : 'butt')
  }
  private mode(st: Style): 'F' | 'S' | 'FD' | null {
    if (st.fill) this.doc.setFillColor(st.fill)
    this.applyStroke(st)
    return st.fill && st.stroke ? 'FD' : st.fill ? 'F' : st.stroke ? 'S' : null
  }
  private reset() {
    this.doc.setLineDashPattern([], 0)
  }

  rect(x: number, y: number, w: number, h: number, style: Style) {
    const m = this.mode(style)
    if (m) this.doc.rect(this.X(x), this.Y(y), w * this.s, h * this.s, m)
    this.reset()
  }
  line(x1: number, y1: number, x2: number, y2: number, style: Stroke) {
    this.applyStroke(style)
    this.doc.line(this.X(x1), this.Y(y1), this.X(x2), this.Y(y2))
    this.reset()
  }
  circle(cx: number, cy: number, r: number, style: Style) {
    const m = this.mode(style)
    if (m) this.doc.circle(this.X(cx), this.Y(cy), r * this.s, m)
    this.reset()
  }
  path(cmds: PathCmd[], style: Style) {
    const m = this.mode(style)
    if (!m) return
    const d = this.doc as any
    for (const c of cmds) {
      if (c[0] === 'M') d.moveTo(this.X(c[1]), this.Y(c[2]))
      else if (c[0] === 'L') d.lineTo(this.X(c[1]), this.Y(c[2]))
      else if (c[0] === 'C') d.curveTo(this.X(c[1]), this.Y(c[2]), this.X(c[3]), this.Y(c[4]), this.X(c[5]), this.Y(c[6]))
      else d.close()
    }
    if (m === 'F') d.fill()
    else if (m === 'S') d.stroke()
    else d.fillStroke()
    this.reset()
  }
  measure(str: string, font: FontKey, size: number, charSpace = 0) {
    return measureWith(this.doc, this.fonts, str, font, size, charSpace)
  }
  text(str: string, x: number, y: number, o: TextOpts) {
    const s = String(str ?? '')
    if (!s) return
    const w = this.measure(s, o.font, o.size, o.charSpace)
    const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0
    this.doc.setFont(this.fonts[o.font], 'normal')
    this.doc.setFontSize(o.size * this.s)
    this.doc.setTextColor(o.color)
    const opts: Record<string, unknown> = {}
    if (o.charSpace) opts.charSpace = o.charSpace * this.s
    if (o.angle) {
      opts.angle = o.angle
      // Alignment along the rotated baseline.
      const rad = (o.angle * Math.PI) / 180
      this.doc.text(s, this.X(x + dx * Math.cos(rad)), this.Y(y - dx * Math.sin(rad)), opts)
      return
    }
    this.doc.text(s, this.X(x + dx), this.Y(y), opts)
  }
  image(img: PainterImage, x: number, y: number, w: number, h: number) {
    this.doc.addImage(img.data, img.format, this.X(x), this.Y(y), w * this.s, h * this.s, img.key, 'FAST')
  }
  cutout(cmds: PathCmd[]) {
    this.path(cmds, { stroke: CUT_GUIDE, lw: 1, dash: [3, 3] })
  }
  qr(m: { size: number; get: (r: number, c: number) => boolean }, x: number, y: number, side: number, color: string) {
    const cell = side / m.size
    this.doc.setFillColor(color)
    for (let r = 0; r < m.size; r++) {
      let c = 0
      while (c < m.size) {
        if (!m.get(r, c)) {
          c++
          continue
        }
        const start = c
        while (c < m.size && m.get(r, c)) c++
        // A hair of overlap so no white seams show between modules.
        this.doc.rect(this.X(x + start * cell), this.Y(y + r * cell), (c - start) * cell * this.s + 0.05, cell * this.s + 0.05, 'F')
      }
    }
  }
}

// ── SVG ──────────────────────────────────────────────────────────────────────

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => (Math.round(v * 100) / 100).toString()

function strokeAttrs(st: Partial<Stroke>): string {
  if (!st.stroke) return ''
  return ` stroke="${esc(st.stroke)}" stroke-width="${n(st.lw ?? 1)}"${st.dash ? ` stroke-dasharray="${st.dash.map(n).join(' ')}"` : ''}${st.cap === 'round' ? ' stroke-linecap="round"' : ''}`
}
const pathD = (cmds: PathCmd[]) => cmds.map((c) => (c[0] === 'Z' ? 'Z' : `${c[0]}${c.slice(1).map((v) => n(v as number)).join(' ')}`)).join('')
const fillAttr = (st: Style) => ` fill="${st.fill ? esc(st.fill) : 'none'}"`

export class SvgPainter implements Painter {
  readonly kind = 'svg' as const
  private parts: string[] = []
  private images = new Map<string, string>()
  private measureFonts = measurer()

  rect(x: number, y: number, w: number, h: number, st: Style) {
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${fillAttr(st)}${strokeAttrs(st)}/>`)
  }
  line(x1: number, y1: number, x2: number, y2: number, st: Stroke) {
    this.parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${strokeAttrs(st)}/>`)
  }
  circle(cx: number, cy: number, r: number, st: Style) {
    this.parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${fillAttr(st)}${strokeAttrs(st)}/>`)
  }
  path(cmds: PathCmd[], st: Style) {
    this.parts.push(`<path d="${pathD(cmds)}"${fillAttr(st)}${strokeAttrs(st)}/>`)
  }
  private cuts: string[] = []
  cutout(cmds: PathCmd[]) {
    this.cuts.push(`<path d="${pathD(cmds)}" fill="#000"/>`)
  }
  measure(str: string, font: FontKey, size: number, charSpace = 0) {
    return measureWith(this.measureFonts.doc, this.measureFonts.fonts, str, font, size, charSpace)
  }
  text(str: string, x: number, y: number, o: TextOpts) {
    const s = String(str ?? '')
    if (!s) return
    const w = this.measure(s, o.font, o.size, o.charSpace)
    const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0
    const ls = o.charSpace ? ` letter-spacing="${n(o.charSpace)}"` : ''
    // xml:space keeps runs of spaces ("TIKÈM  ·  ENTRÉE").
    const common = `font-family="${esc(SVG_FAMILY[o.font])}" font-size="${n(o.size)}" fill="${esc(o.color)}"${ls} xml:space="preserve"`
    if (o.angle) {
      this.parts.push(`<text x="${n(dx)}" y="0" transform="translate(${n(x)} ${n(y)}) rotate(${n(-o.angle)})" ${common}>${esc(s)}</text>`)
      return
    }
    this.parts.push(`<text x="${n(x + dx)}" y="${n(y)}" ${common}>${esc(s)}</text>`)
  }
  image(img: PainterImage, x: number, y: number, w: number, h: number) {
    if (!this.images.has(img.key)) {
      const id = `im${this.images.size}`
      const mime = img.format === 'PNG' ? 'image/png' : 'image/jpeg'
      this.images.set(img.key, id)
      this.defs.push(`<image id="${id}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" href="data:${mime};base64,${Buffer.from(img.data).toString('base64')}"/>`)
    }
    this.parts.push(`<use href="#${this.images.get(img.key)}" x="${n(x)}" y="${n(y)}"/>`)
  }
  qr(m: { size: number; get: (r: number, c: number) => boolean }, x: number, y: number, side: number, color: string) {
    const cell = side / m.size
    let d = ''
    for (let r = 0; r < m.size; r++) {
      let c = 0
      while (c < m.size) {
        if (!m.get(r, c)) {
          c++
          continue
        }
        const start = c
        while (c < m.size && m.get(r, c)) c++
        d += `M${n(x + start * cell)} ${n(y + r * cell)}h${n((c - start) * cell)}v${n(cell)}h${n(-(c - start) * cell)}Z`
      }
    }
    this.parts.push(`<path d="${d}" fill="${esc(color)}" shape-rendering="crispEdges"/>`)
  }

  private defs: string[] = []

  /**
   * The ticket as one standalone SVG (artboard viewBox).
   * `paper`: the card / sheet colour behind the ink (white when absent).
   * `multiply`: ink on coloured card stock darkens the card instead of
   * covering it (a grey line on yellow card is a darker yellow), as in print.
   * `idPrefix` keeps ids unique when several proofs share one page.
   */
  toSvg(opts: { paper?: string | null; multiply?: boolean; title?: string; idPrefix?: string } = {}): string {
    const id = (opts.idPrefix || 'tk').replace(/[^a-zA-Z0-9_-]/g, '')
    const defs = this.defs.map((d) => d.replace(/id="im(\d+)"/, `id="${id}im$1"`))
    const body = this.parts.join('').replace(/href="#im(\d+)"/g, `href="#${id}im$1"`)
    const mask = this.cuts.length
      ? `<mask id="${id}cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${ARTBOARD.w}" height="${ARTBOARD.h}"><rect width="${ARTBOARD.w}" height="${ARTBOARD.h}" fill="#fff"/>${this.cuts.join('')}</mask>`
      : ''
    const paper = `<rect width="${ARTBOARD.w}" height="${ARTBOARD.h}" fill="${esc(opts.paper || '#FFFFFF')}"/>`
    const ink = opts.multiply ? `<g style="mix-blend-mode:multiply">${body}</g>` : body
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARTBOARD.w} ${ARTBOARD.h}" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ''}>` +
      (defs.length || mask ? `<defs>${defs.join('')}${mask}</defs>` : '') +
      `<g${mask ? ` mask="url(#${id}cut)"` : ''} style="isolation:isolate">${paper}${ink}</g>` +
      `</svg>`
    )
  }
}
