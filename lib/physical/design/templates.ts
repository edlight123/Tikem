/**
 * The six printed-ticket templates, drawn through a Painter (./painter.ts) in
 * the 528 × 1344 artboard of the approved designs (2.75 × 7 in, 192 per inch).
 *
 *   coloured_card  StubDuotone: black only on coloured card stock. Halftone
 *                  artist photo, huge condensed headline, big date/time, tier
 *                  and price boxes, sponsor strip, guilloché lines, microtext,
 *                  perforation with notches, stub.
 *   kraft_foil     StubFoil: kraft ground, holographic foil border, vèvè
 *                  corners, sepia photo, serif title, price rule, three
 *                  columns date / time / tier, stub.
 *   clean_white    Main (tall): white, one accent, serif title, vèvè watermark.
 *   poster_photo   Full-bleed photo under a dark scrim (ink-heavy, print shop).
 *   bold_type      No photo: giant stacked type, stripe band, guilloché.
 *   veve_border    Thin vèvè line-art border, centred serif layout.
 *
 * Every template carries the security essentials: the ticket's own QR, its
 * serial (body and stub), a stub with QR + serial + holder line, "Valide une
 * fois vendu", a microtext line repeating the serial, and a guilloché / line
 * pattern. Ink colours are chosen to stay legible in grayscale.
 *
 * Colours here are print colours (paper, ink), not site UI colours.
 */

import QRCode from 'qrcode'
import type { Painter, PainterImage, PathCmd, FontKey } from './painter'
import { ARTBOARD } from './painter'
import type { TicketLabels, TicketFacts } from './facts'
import { serialNumberPart } from './facts'
import type { Swatch, TemplateId, TicketTemplate } from './registry'

const W = ARTBOARD.w
const H = ARTBOARD.h

export interface PreparedLogo {
  img: PainterImage
  /** Natural aspect ratio (w / h). */
  ratio: number
}

export interface DrawContext {
  template: TicketTemplate
  swatch: Swatch
  facts: TicketFacts
  labels: TicketLabels
  ticket: { serial: string; qrPayload: string; tierName?: string }
  /** The artist photo, already sized / toned for this template (PHOTO_SPECS). */
  photo: PainterImage | null
  logos: PreparedLogo[]
}

/** How each template wants its photo: box size (artboard units) and treatment. */
export type PhotoMode = 'halftone' | 'ink' | 'scrim'
export const PHOTO_SPECS: Partial<Record<TemplateId, { w: number; h: number; mode: PhotoMode; ink?: string; focus?: 'top' | 'centre' }>> = {
  coloured_card: { w: 460, h: 520, mode: 'halftone', ink: '#141414', focus: 'top' },
  kraft_foil: { w: 432, h: 526, mode: 'ink', ink: '#3A2A18', focus: 'top' },
  poster_photo: { w: W, h: 900, mode: 'scrim', focus: 'top' },
}
/** Logos: black-only templates get them as ink; the rest keep their colours. */
export function logoMode(t: TemplateId): 'ink' | 'color' {
  return t === 'coloured_card' || t === 'bold_type' || t === 'veve_border' ? 'ink' : 'color'
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mix `a` into `b` by `t` (0 = b, 1 = a). For tints that print as a screen of the same ink. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (p: number, s: number) => (p >> s) & 255
  const c = (s: number) => Math.round(ch(pa, s) * t + ch(pb, s) * (1 - t))
  return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** Relative luminance 0..1 (sRGB, rough): picks readable ink on a ground. */
export function luminance(hex: string): number {
  const p = parseInt(hex.slice(1), 16)
  const ch = (s: number) => ((p >> s) & 255) / 255
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0)
}

function wrapWords(p: Painter, text: string, font: FontKey, size: number, maxW: number, cs = 0): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (!cur || p.measure(next, font, size, cs) <= maxW) cur = next
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function ellipsize(p: Painter, line: string, font: FontKey, size: number, maxW: number, cs = 0): string {
  if (p.measure(line, font, size, cs) <= maxW) return line
  let s = line
  while (s.length > 1 && p.measure(`${s}…`, font, size, cs) > maxW) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/** The largest size (≤ max) at which `text` wraps into ≤ maxLines lines of ≤ maxW; ellipsized at min. */
export function fitBlock(p: Painter, text: string, font: FontKey, max: number, min: number, maxW: number, maxLines: number, cs = 0) {
  const sizes: number[] = []
  for (let size = max; size > min; size = Math.floor(size * 0.95)) sizes.push(size)
  sizes.push(min)
  for (const size of sizes) {
    const lines = wrapWords(p, text, font, size, maxW, cs)
    // No orphan scraps ("FÊTE DE / LA / MUSIQUE"): a 1–2 letter line means shrink on.
    const orphan = lines.length > 1 && lines.some((l) => l.replace(/\s/g, '').length < 3)
    if (!orphan && lines.length <= maxLines && lines.every((l) => p.measure(l, font, size, cs) <= maxW)) return { size, lines }
  }
  const lines = wrapWords(p, text, font, min, maxW, cs)
  const kept = lines.slice(0, maxLines)
  if (lines.length > maxLines) kept[maxLines - 1] = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`
  return { size: min, lines: kept.map((l) => ellipsize(p, l, font, min, maxW, cs)) }
}

/** One line at the largest size ≤ max that fits maxW (never below min; ellipsized there). */
function fitLine(p: Painter, text: string, font: FontKey, max: number, min: number, maxW: number, cs = 0) {
  let size = max
  while (size > min && p.measure(text, font, size, cs) > maxW) size -= 1
  return { size, text: ellipsize(p, text, font, size, maxW, cs) }
}

/** A sine wave as a polyline: the guilloché building block. */
function wave(y: number, amp: number, period: number, phase: number, x0: number = 0, x1: number = W): PathCmd[] {
  const cmds: PathCmd[] = []
  for (let x = x0; x <= x1 + 0.01; x += 6) {
    const yy = y + amp * Math.sin(((x - x0) / period) * 2 * Math.PI + phase)
    cmds.push([cmds.length ? 'L' : 'M', x, yy])
  }
  return cmds
}

/** A band of interlaced waves (two families out of phase): the security pattern. */
function guilloche(p: Painter, y: number, color: string, opts: { lines?: number; gap?: number; amp?: number; period?: number; lw?: number; x0?: number; x1?: number } = {}) {
  const lines = opts.lines ?? 5
  const gap = opts.gap ?? 12
  for (let i = 0; i < lines; i++) {
    p.path(wave(y + i * gap, opts.amp ?? 14, opts.period ?? 264, 0, opts.x0, opts.x1), { stroke: color, lw: opts.lw ?? 0.8 })
    p.path(wave(y + i * gap, opts.amp ?? 14, opts.period ?? 264, Math.PI, opts.x0, opts.x1), { stroke: color, lw: (opts.lw ?? 0.8) * 0.7 })
  }
}

/** "TIKEM·SECURE·FETE-VIP-B1-0001·…" filling `w`: too small to copy cleanly. */
function microtext(p: Painter, ctx: DrawContext, x: number, y: number, w: number, color: string) {
  const unit = `${ctx.labels.secure}·${ctx.ticket.serial}·`
  let s = unit
  const size = 7
  const cs = 0.7
  while (p.measure(s, 'sansBold', size, cs) < w) s += unit
  while (s.length > 1 && p.measure(s, 'sansBold', size, cs) > w) s = s.slice(0, -1)
  p.text(s, x, y, { font: 'sansBold', size, color, charSpace: cs })
}

/** Half-disc notches at both edges + a dashed tear line. */
function perforation(p: Painter, y: number, color: string, opts: { dotted?: boolean; lw?: number; inset?: number } = {}) {
  const r = 18
  const k = 0.5523 * r
  p.cutout([['M', 0, y - r], ['C', k, y - r, r, y - k, r, y], ['C', r, y + k, k, y + r, 0, y + r], ['Z']])
  p.cutout([['M', W, y - r], ['C', W - k, y - r, W - r, y - k, W - r, y], ['C', W - r, y + k, W - k, y + r, W, y + r], ['Z']])
  const inset = opts.inset ?? r
  p.line(inset, y, W - inset, y, {
    stroke: color,
    lw: opts.lw ?? 2.5,
    dash: opts.dotted ? [0.1, 7] : [8, 6],
    cap: opts.dotted ? 'round' : 'butt',
  })
}

let qrCache = new Map<string, ReturnType<typeof QRCode.create>>()
function qrFor(payload: string) {
  let q = qrCache.get(payload)
  if (!q) {
    if (qrCache.size > 64) qrCache = new Map()
    q = QRCode.create(String(payload || 'TIKEM'), { errorCorrectionLevel: 'M' })
    qrCache.set(payload, q)
  }
  const m = q.modules as any
  return { size: m.size as number, get: (r: number, c: number) => !!m.get(r, c) }
}

interface StubStyle {
  ink: string
  muted: string
  /** White box behind the QR (printed grounds only; never on card stock). */
  qrBox?: string | null
  serialFont: FontKey
  qrSide?: number
  dateLine?: boolean
  labelFont?: FontKey
  padTop?: number
  x?: number
}

/** The stub under the perforation: QR, "TALON · VALIDE UNE FOIS VENDU", serial, date, holder line. */
function stub(p: Painter, ctx: DrawContext, top: number, s: StubStyle) {
  const x = s.x ?? 34
  const side = s.qrSide ?? 150
  const qy = top + (s.padTop ?? 18)
  if (s.qrBox) p.rect(x, qy, side, side, { fill: s.qrBox })
  const pad = 10
  p.qr(qrFor(ctx.ticket.qrPayload), x + pad, qy + pad, side - 2 * pad, '#111111')
  const tx = x + side + 22
  const tw = W - 34 - tx
  const label = fitLine(p, ctx.labels.stubValid, s.labelFont ?? 'sansBold', 11, 8, tw, 2.2)
  let y = qy + 24
  p.text(label.text, tx, y, { font: s.labelFont ?? 'sansBold', size: label.size, color: s.ink, charSpace: 2.2 })
  const serial = fitLine(p, ctx.ticket.serial, s.serialFont, s.serialFont === 'anton' ? 30 : 22, 12, tw)
  y += 14 + serial.size * 0.95
  p.text(serial.text, tx, y, { font: s.serialFont, size: serial.size, color: s.ink })
  if (s.dateLine !== false) {
    const line = fitLine(p, [ctx.facts.dayShort, ctx.facts.time, ctx.ticket.tierName || ctx.facts.tierName].filter(Boolean).join(' · '), 'sansBold', 13, 9, tw)
    y += 26
    p.text(line.text, tx, y, { font: 'sansBold', size: line.size, color: s.ink })
  }
  y += 34
  const hl = p.measure(ctx.labels.holder, 'sansBold', 11, 1.8)
  p.text(ctx.labels.holder, tx, y, { font: 'sansBold', size: 11, color: s.ink, charSpace: 1.8 })
  p.line(tx + hl + 8, y + 1, W - 34, y + 1, { stroke: s.muted, lw: 1.5 })
}

/** "PRÉSENTÉ PAR" + logos (or the organizer's name), right-aligned in a row. */
function sponsorStrip(p: Painter, ctx: DrawContext, y: number, ink: string, opts: { x0?: number; x1?: number; center?: boolean } = {}) {
  const x0 = opts.x0 ?? 34
  const x1 = opts.x1 ?? W - 34
  const h = 44
  if (!ctx.logos.length && !ctx.facts.organizerName) return
  const labelW = p.measure(ctx.labels.presentedBy, 'sansBold', 11, 2.2)
  const room = x1 - x0 - labelW - 16
  if (ctx.logos.length) {
    const gap = 12
    let widths = ctx.logos.map((l) => Math.min(140, h * l.ratio))
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    const k = total > room ? (room - gap * (widths.length - 1)) / (total - gap * (widths.length - 1)) : 1
    widths = widths.map((w) => w * k)
    const used = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
    const startX = opts.center ? x0 + (x1 - x0 - (labelW + 16 + used)) / 2 : x0
    p.text(ctx.labels.presentedBy, startX, y + h / 2 + 4, { font: 'sansBold', size: 11, color: ink, charSpace: 2.2 })
    let x = opts.center ? startX + labelW + 16 : x1 - used
    ctx.logos.forEach((l, i) => {
      const w = widths[i]
      const lh = w / l.ratio
      p.image(l.img, x, y + (h - lh) / 2, w, lh)
      x += w + gap
    })
    return
  }
  const name = fitLine(p, ctx.facts.organizerName, 'sansBold', 15, 10, room)
  if (opts.center) {
    const total = labelW + 12 + p.measure(name.text, 'sansBold', name.size)
    const sx = x0 + (x1 - x0 - total) / 2
    p.text(ctx.labels.presentedBy, sx, y + h / 2 + 4, { font: 'sansBold', size: 11, color: ink, charSpace: 2.2 })
    p.text(name.text, sx + labelW + 12, y + h / 2 + 5, { font: 'sansBold', size: name.size, color: ink })
    return
  }
  p.text(ctx.labels.presentedBy, x0, y + h / 2 + 4, { font: 'sansBold', size: 11, color: ink, charSpace: 2.2 })
  p.text(name.text, x1, y + h / 2 + 5, { font: 'sansBold', size: name.size, color: ink, align: 'right' })
}

/** The vèvè of the white designs, in a 120 box: diamonds, cross, circles, curls. */
function veve(p: Painter, x: number, y: number, size: number, color: string, lw = 1.2, accent?: string) {
  const k = size / 120
  const P = (px: number, py: number): [number, number] => [x + px * k, y + py * k]
  const poly = (pts: Array<[number, number]>) => p.path([['M', ...P(...pts[0])], ...pts.slice(1).map((q) => ['L', ...P(...q)] as PathCmd), ['Z']], { stroke: color, lw })
  poly([[60, 8], [112, 60], [60, 112], [8, 60]])
  poly([[60, 26], [94, 60], [60, 94], [26, 60]])
  p.line(...P(60, 8), ...P(60, 112), { stroke: color, lw })
  p.line(...P(8, 60), ...P(112, 60), { stroke: color, lw })
  p.circle(...P(60, 60), 7 * k, { stroke: color, lw })
  for (const [cx, cy] of [[60, 8], [112, 60], [60, 112], [8, 60]] as const) p.circle(...P(cx, cy), 3 * k, { stroke: color, lw })
  // Curls: quadratic "q-8 -8 0 -14" from each inner corner, as cubics.
  const curl = (sx: number, sy: number, qx: number, qy: number, ex: number, ey: number) => {
    const c1: [number, number] = [sx + (2 / 3) * (qx - sx), sy + (2 / 3) * (qy - sy)]
    const c2: [number, number] = [ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey)]
    p.path([['M', ...P(sx, sy)], ['C', ...P(...c1), ...P(...c2), ...P(ex, ey)]], { stroke: color, lw })
  }
  curl(43, 43, 35, 35, 43, 29)
  curl(77, 43, 85, 35, 77, 29)
  curl(43, 77, 35, 85, 43, 91)
  curl(77, 77, 85, 85, 77, 91)
  if (accent) {
    for (const [cx, cy, horiz] of [[60, 37, false], [60, 83, false], [37, 60, true], [83, 60, true]] as const) {
      const d = 4
      const pts: Array<[number, number]> = horiz
        ? [[cx - d * 1.6, cy], [cx, cy - d], [cx + d * 1.6, cy], [cx, cy + d]]
        : [[cx, cy - d * 1.6], [cx + d, cy], [cx, cy + d * 1.6], [cx - d, cy]]
      p.path([['M', ...P(...pts[0])], ...pts.slice(1).map((q) => ['L', ...P(...q)] as PathCmd), ['Z']], { stroke: accent, lw })
    }
  }
}

/** The small diamond-and-cross mark of the kraft design (80 box). */
function veveCorner(p: Painter, x: number, y: number, size: number, color: string, lw = 1.6) {
  const k = size / 80
  const P = (px: number, py: number): [number, number] => [x + px * k, y + py * k]
  p.path([['M', ...P(40, 4)], ['L', ...P(76, 40)], ['L', ...P(40, 76)], ['L', ...P(4, 40)], ['Z']], { stroke: color, lw })
  p.line(...P(40, 4), ...P(40, 76), { stroke: color, lw })
  p.line(...P(4, 40), ...P(76, 40), { stroke: color, lw })
  p.circle(...P(40, 40), 7 * k, { stroke: color, lw })
}

/** "tikèm" in the serif italic, optionally with the è in an accent. */
function wordmark(p: Painter, x: number, y: number, size: number, ink: string, accent?: string, align: 'left' | 'center' = 'left') {
  const w = p.measure('tikèm', 'serifItalic', size)
  let cx = align === 'center' ? x - w / 2 : x
  for (const ch of ['tik', 'è', 'm']) {
    p.text(ch, cx, y, { font: 'serifItalic', size, color: ch === 'è' && accent ? accent : ink })
    cx += p.measure(ch, 'serifItalic', size)
  }
}

/** Title lines from the bottom up (anchored to `bottom`), condensed display. */
function stackedTitle(p: Painter, lines: string[], size: number, x: number, bottom: number, color: string, lh = 0.92, align: 'left' | 'center' = 'left') {
  for (let i = lines.length - 1, y = bottom; i >= 0; i--, y -= size * lh) {
    p.text(lines[i], align === 'center' ? x : x, y, { font: 'anton', size, color, align })
  }
}

// ── 1. coloured card ─────────────────────────────────────────────────────────

function drawColouredCard(p: Painter, ctx: DrawContext) {
  const K = '#141414'
  const f = ctx.facts
  const L = ctx.labels
  const faint = mix(K, '#FFFFFF', 0.2)
  guilloche(p, 46, faint, { lines: 4, gap: 11 })
  guilloche(p, 946, faint, { lines: 3, gap: 11 })

  wordmark(p, 34, 62, 40, K)
  p.text(L.admit, W - 34, 50, { font: 'sansBold', size: 12, color: K, align: 'right', charSpace: 2.9 })
  p.text(`${L.numberSign} ${serialNumberPart(ctx.ticket.serial)}`, W - 34, 68, { font: 'sansBold', size: 13, color: K, align: 'right', charSpace: 1 })

  // Big date and time.
  const time = f.time
  const timeW = p.measure(time, 'anton', 44)
  const day = fitLine(p, f.dayShort.toUpperCase(), 'anton', 44, 26, W - 68 - timeW - 18)
  p.text(day.text, 34, 136, { font: 'anton', size: day.size, color: K })
  p.text(time, W - 34, 136, { font: 'anton', size: 44, color: K, align: 'right' })

  // Photo (halftone) with the headline over its foot.
  const box = { x: 34, y: 162, w: 460, h: 520 }
  if (ctx.photo) p.image(ctx.photo, box.x, box.y, box.w, box.h)
  else {
    // No photo: a quiet dot screen keeps the poster block.
    for (let yy = box.y + 6; yy < box.y + box.h; yy += 12) {
      for (let xx = box.x + 6 + ((yy / 12) % 2 ? 6 : 0); xx < box.x + box.w; xx += 12) p.circle(xx, yy, 1.6, { fill: mix(K, '#FFFFFF', 0.35) })
    }
  }
  const title = fitBlock(p, f.title.toUpperCase(), 'anton', 112, 44, box.w, 3)
  stackedTitle(p, title.lines, title.size, box.x, box.y + box.h - 8, K)

  // Venue.
  const venue = fitLine(p, f.venueName || f.venueLine, 'serifItalic', 34, 20, W - 68)
  p.text(venue.text, 34, 730, { font: 'serifItalic', size: venue.size, color: K })
  const sub = fitLine(p, [f.venueName ? cityOf(f) : '', f.phone].filter(Boolean).join(' · '), 'sansBold', 15, 10, W - 68)
  p.text(sub.text, 34, 756, { font: 'sansBold', size: sub.size, color: K })

  // Tier and price boxes.
  const by = 780
  const bw = (460 - 14) / 2
  const bh = 86
  for (const [i, label, value] of [
    [0, L.category, ctx.ticket.tierName || f.tierName],
    [1, L.price, f.priceLine],
  ] as const) {
    const bx = 34 + i * (bw + 14)
    p.rect(bx, by, bw, bh, { stroke: K, lw: 2 })
    p.text(label, bx + 14, by + 25, { font: 'sansBold', size: 11, color: K, charSpace: 2.2 })
    const v = fitLine(p, String(value).toUpperCase(), 'anton', 40, 18, bw - 28)
    p.text(v.text, bx + 14, by + 72, { font: 'anton', size: v.size, color: K })
  }

  sponsorStrip(p, ctx, 884, K)
  microtext(p, ctx, 34, 1106, W - 68, K)
  perforation(p, 1128, K)
  stub(p, ctx, 1146, { ink: K, muted: K, qrBox: null, serialFont: 'anton' })
}

function cityOf(f: TicketFacts): string {
  const v = f.venueLine
  return f.venueName && v.startsWith(f.venueName) ? v.slice(f.venueName.length).replace(/^,\s*/, '') : v
}

// ── 2. kraft + foil ──────────────────────────────────────────────────────────

const FOIL = ['#D9DDE3', '#F7F3FF', '#BFE9E0', '#E7E9EE', '#F9E4F1', '#C9D6F2', '#E3E6EA']

function foilAt(t: number): string {
  const seg = (FOIL.length - 1) * Math.min(1, Math.max(0, t))
  const i = Math.min(FOIL.length - 2, Math.floor(seg))
  return mix(FOIL[i + 1], FOIL[i], seg - i)
}

/** The holographic foil frame as fine diagonal colour steps. */
function foilFrame(p: Painter, inset: number) {
  const step = 12
  const tOf = (x: number, y: number) => (x + y) / (W + H)
  for (let x = 0; x < W; x += step) {
    p.rect(x, 0, step + 0.5, inset, { fill: foilAt(tOf(x, 0)) })
    p.rect(x, H - inset, step + 0.5, inset, { fill: foilAt(tOf(x, H)) })
  }
  for (let y = inset; y < H - inset; y += step) {
    p.rect(0, y, inset, step + 0.5, { fill: foilAt(tOf(0, y)) })
    p.rect(W - inset, y, inset, step + 0.5, { fill: foilAt(tOf(W, y)) })
  }
}

function drawKraftFoil(p: Painter, ctx: DrawContext) {
  const ink = '#1B1712'
  const f = ctx.facts
  const L = ctx.labels
  const inset = 16
  foilFrame(p, inset)
  p.rect(inset, inset, W - 2 * inset, H - 2 * inset, { fill: ctx.swatch.hex })
  // Kraft fibres: fine vertical lines, a shade darker than the ground.
  const fibre = mix('#000000', ctx.swatch.hex, 0.06)
  for (let x = inset + 4; x < W - inset; x += 5) p.line(x, inset, x, H - inset, { stroke: fibre, lw: 1 })

  veveCorner(p, inset + 18, inset + 18, 64, ink)
  veveCorner(p, W - inset - 18 - 64, inset + 18, 64, ink)
  wordmark(p, W / 2, 80, 38, ink, undefined, 'center')
  p.text(`${L.admit} · ${L.numberSign} ${serialNumberPart(ctx.ticket.serial)}`, W / 2, 98, { font: 'sansBold', size: 11, color: ink, align: 'center', charSpace: 3.3 })

  const box = { x: 46, y: 116, w: 436, h: 530 }
  if (ctx.photo) p.image(ctx.photo, box.x + 2, box.y + 2, box.w - 4, box.h - 4)
  else guilloche(p, box.y + 60, mix(ink, ctx.swatch.hex, 0.35), { lines: 30, gap: 12, x0: box.x, x1: box.x + box.w, amp: 10, period: 140 })
  p.rect(box.x, box.y, box.w, box.h, { stroke: ink, lw: 2 })

  const title = fitBlock(p, f.title, 'serifItalic', 64, 32, box.w, 2)
  let y = box.y + box.h + 20 + title.size * 0.78
  for (const line of title.lines) {
    p.text(line, W / 2, y, { font: 'serifItalic', size: title.size, color: ink, align: 'center' })
    y += title.size * 0.95
  }
  y -= title.size * 0.95
  if (f.venueName) {
    const v = fitLine(p, f.venueName.toUpperCase(), 'sansBold', 12, 8, box.w, 3.6)
    y += 34
    p.text(v.text, W / 2, y, { font: 'sansBold', size: v.size, color: ink, align: 'center', charSpace: 3.6 })
  }

  // Price between two rules.
  y += 58
  const price = fitLine(p, f.priceLine, 'anton', 52, 26, box.w - 80)
  const pw = p.measure(price.text, 'anton', price.size)
  p.text(price.text, W / 2, y, { font: 'anton', size: price.size, color: ink, align: 'center' })
  const ry = y - price.size * 0.36
  p.rect(box.x, ry, (box.w - pw) / 2 - 12, 1.5, { fill: ink })
  p.rect(W / 2 + pw / 2 + 12, ry, (box.w - pw) / 2 - 12, 1.5, { fill: ink })

  // Date / time / tier.
  y += 34
  const colW = box.w / 3
  ;[
    [L.date, f.dayShort],
    [L.time, f.time],
    [L.category, ctx.ticket.tierName || f.tierName],
  ].forEach(([label, value], i) => {
    const cx = box.x + colW * i + colW / 2
    p.text(label, cx, y, { font: 'sansBold', size: 10, color: ink, align: 'center', charSpace: 2 })
    const v = fitLine(p, value, 'sansBold', 17, 10, colW - 8)
    p.text(v.text, cx, y + 22, { font: 'sansBold', size: v.size, color: ink, align: 'center' })
  })
  y += 52
  const where = fitLine(p, [f.venueLine, f.phone].filter(Boolean).join(' · '), 'sansBold', 13, 9, box.w)
  p.text(where.text, W / 2, y, { font: 'sansBold', size: where.size, color: ink, align: 'center' })

  sponsorStrip(p, ctx, y + 18, ink, { x0: box.x, x1: box.x + box.w, center: true })
  microtext(p, ctx, box.x, 1110, box.w, mix(ink, ctx.swatch.hex, 0.7))
  p.line(inset + 4, 1128, W - inset - 4, 1128, { stroke: ink, lw: 2.5, dash: [0.1, 7], cap: 'round' })
  stub(p, ctx, 1132, { ink, muted: ink, qrBox: '#FFFFFF', serialFont: 'anton', qrSide: 140, x: 42, padTop: 22 })
}

// ── 3. clean white ───────────────────────────────────────────────────────────

function drawCleanWhite(p: Painter, ctx: DrawContext) {
  const A = ctx.swatch.hex
  const ink = '#111111'
  const soft = '#5C5C5C'
  const f = ctx.facts
  const L = ctx.labels
  p.rect(0, 0, 6, H, { fill: A })
  veve(p, W - 22 - 92, 22, 92, '#C9C9C9', 1.2)

  wordmark(p, 40, 64, 30, ink, A)
  const wm = p.measure('tikèm', 'serifItalic', 30)
  p.circle(40 + wm + 12, 56, 2, { fill: '#9A9A9A' })
  p.text(L.admit, 40 + wm + 24, 60, { font: 'sansBold', size: 12, color: soft, charSpace: 2.6 })

  const title = fitBlock(p, f.title, 'serifItalic', 66, 34, W - 40 - 34 - 20, 4)
  let y = 150 + title.size * 0.7
  for (const line of title.lines) {
    p.text(line, 40, y, { font: 'serifItalic', size: title.size, color: ink })
    y += title.size * 0.98
  }
  y += 10
  const when = fitBlock(p, [cap1(f.dateLong), f.time].filter(Boolean).join(' · '), 'sansBold', 17, 12, W - 80, 2)
  for (const line of when.lines) {
    p.text(line, 40, y, { font: 'sansBold', size: when.size, color: ink })
    y += when.size * 1.35
  }
  const where = fitBlock(p, [f.venueLine, f.phone].filter(Boolean).join(' · '), 'sans', 16, 11, W - 80, 2)
  for (const line of where.lines) {
    p.text(line, 40, y, { font: 'sans', size: where.size, color: '#4A4A4A' })
    y += where.size * 1.35
  }

  // The quiet middle: a large vèvè and a guilloché band behind it.
  const freeTop = y + 20
  const freeBottom = 870
  const vs = Math.max(120, Math.min(300, freeBottom - freeTop - 40))
  const vy = freeTop + (freeBottom - freeTop - vs) / 2
  guilloche(p, vy + vs / 2 - 30, '#E6E6E6', { lines: 6, gap: 12, x0: 6 })
  veve(p, W / 2 - vs / 2, vy, vs, '#D4D4D4', 1.2, A)

  // Tier, price, serial.
  const ty = 920
  const tier = fitLine(p, (ctx.ticket.tierName || f.tierName).toUpperCase(), 'sansBold', 26, 14, 220, 1.5)
  p.text(tier.text, 40, ty, { font: 'sansBold', size: tier.size, color: A, charSpace: 1.5 })
  const price = fitLine(p, f.priceLine, 'sansBold', 26, 14, 220)
  p.text(price.text, W - 34, ty, { font: 'sansBold', size: price.size, color: ink, align: 'right' })
  p.text(ctx.ticket.serial, 40, ty + 32, { font: 'sansBold', size: 15, color: ink, charSpace: 1.2 })
  p.text(L.validOnceSold, W - 34, ty + 32, { font: 'sansBold', size: 12, color: soft, align: 'right' })

  sponsorStrip(p, ctx, 990, soft, { x0: 40 })
  microtext(p, ctx, 40, 1106, W - 74, '#8A8A8A')
  perforation(p, 1128, '#9A9A9A', { lw: 1.5 })
  stub(p, ctx, 1146, { ink, muted: '#8A8A8A', qrBox: null, serialFont: 'sansBold', x: 40 })
}

const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// ── 4. poster photo ──────────────────────────────────────────────────────────

function drawPosterPhoto(p: Painter, ctx: DrawContext) {
  const A = ctx.swatch.hex
  const ground = '#111111'
  const white = '#FFFFFF'
  const f = ctx.facts
  const L = ctx.labels
  p.rect(0, 0, W, 1128, { fill: ground })
  if (ctx.photo) p.image(ctx.photo, 0, 0, W, 900)
  else guilloche(p, 120, '#2A2A2A', { lines: 50, gap: 15, amp: 18, period: 200 })

  wordmark(p, 34, 66, 38, white)
  p.text(L.admit, W - 34, 52, { font: 'sansBold', size: 12, color: white, align: 'right', charSpace: 2.9 })
  p.text(`${L.numberSign} ${serialNumberPart(ctx.ticket.serial)}`, W - 34, 70, { font: 'sansBold', size: 13, color: white, align: 'right', charSpace: 1 })

  const title = fitBlock(p, f.title.toUpperCase(), 'anton', 120, 44, W - 68, 3)
  stackedTitle(p, title.lines, title.size, 34, 850, white)
  const when = fitLine(p, `${f.dayShort.toUpperCase()} · ${f.time}`, 'anton', 40, 22, W - 68)
  p.text(when.text, 34, 906, { font: 'anton', size: when.size, color: A })
  const where = fitLine(p, [f.venueLine, f.phone].filter(Boolean).join(' · '), 'sansBold', 15, 10, W - 68)
  p.text(where.text, 34, 936, { font: 'sansBold', size: where.size, color: '#E6E6E6' })

  const by = 956
  const bw = (460 - 14) / 2
  for (const [i, label, value] of [
    [0, L.category, ctx.ticket.tierName || f.tierName],
    [1, L.price, f.priceLine],
  ] as const) {
    const bx = 34 + i * (bw + 14)
    p.rect(bx, by, bw, 80, { stroke: A, lw: 2 })
    p.text(label, bx + 14, by + 23, { font: 'sansBold', size: 11, color: A, charSpace: 2.2 })
    const v = fitLine(p, String(value).toUpperCase(), 'anton', 36, 16, bw - 28)
    p.text(v.text, bx + 14, by + 66, { font: 'anton', size: v.size, color: white })
  }
  sponsorStrip(p, ctx, 1046, '#BDBDBD')
  microtext(p, ctx, 34, 1108, W - 68, '#5A5A5A')
  perforation(p, 1128, '#8A8A8A', { lw: 2 })
  stub(p, ctx, 1146, { ink: '#111111', muted: '#111111', qrBox: null, serialFont: 'anton' })
}

// ── 5. bold type ─────────────────────────────────────────────────────────────

function drawBoldType(p: Painter, ctx: DrawContext) {
  const I = ctx.swatch.hex
  const K = '#141414'
  const f = ctx.facts
  const L = ctx.labels
  // Stripe band: diagonal bars.
  for (let x = -104; x < W + 8; x += 18) {
    const poly = clipX([[x, 96], [x + 96, 0], [x + 104, 0], [x + 8, 96]], 0, W)
    if (poly.length >= 3) p.path([['M', ...poly[0]], ...poly.slice(1).map((q) => ['L', ...q] as PathCmd), ['Z']], { fill: I })
  }
  p.rect(0, 96, W, 4, { fill: K })

  wordmark(p, 34, 150, 34, K)
  p.text(`${L.admit} · ${L.numberSign} ${serialNumberPart(ctx.ticket.serial)}`, W - 34, 144, { font: 'sansBold', size: 12, color: K, align: 'right', charSpace: 2.4 })

  // Giant stacked title: each line sized to the full width.
  const words = f.title.toUpperCase().split(/\s+/).filter(Boolean)
  const lines = groupWords(p, words, W - 68)
  const sizes = lines.map((l) => Math.min(190, ((W - 68) * 0.97) / (p.measure(l, 'anton', 100) / 100)))
  const total = sizes.reduce((a, s) => a + s * 0.9, 0)
  const room = 500
  const k = total > room ? room / total : 1
  let y = 196
  for (let i = 0; i < lines.length; i++) {
    const s = Math.max(28, sizes[i] * k)
    y += s * 0.86
    p.text(ellipsize(p, lines[i], 'anton', s, W - 68), 34, y, { font: 'anton', size: s, color: I })
    y += s * 0.04
  }

  // Date block.
  const dy = Math.min(Math.max(y + 64, 690), 750)
  guilloche(p, dy - 40, mix(I, '#FFFFFF', 0.22), { lines: 4, gap: 12 })
  const dayNum = f.dateNumeric.split('.')[0] || ''
  const big = 170
  p.text(dayNum, 34, dy + 120, { font: 'anton', size: big, color: K })
  const nx = 34 + p.measure(dayNum, 'anton', big) + 18
  const month = f.dayShort.split(' ').slice(-1)[0] || ''
  const weekday = cap1(f.dateLong.split(' ')[0] || '')
  const colW = W - 34 - nx
  p.text(fitLine(p, month.toUpperCase(), 'anton', 56, 24, colW).text, nx, dy + 38, { font: 'anton', size: fitLine(p, month.toUpperCase(), 'anton', 56, 24, colW).size, color: K })
  p.text(fitLine(p, weekday.toUpperCase(), 'sansBold', 15, 10, colW, 2).text, nx, dy + 66, { font: 'sansBold', size: 15, color: K, charSpace: 2 })
  const t = fitLine(p, f.time, 'anton', 56, 24, colW)
  p.text(t.text, nx, dy + 124, { font: 'anton', size: t.size, color: I })
  const where = fitLine(p, [f.venueLine, f.phone].filter(Boolean).join(' · '), 'sansBold', 15, 10, W - 68)
  p.text(where.text, 34, dy + 164, { font: 'sansBold', size: where.size, color: K })

  // Tier and price on a heavy rule.
  const ty = 970
  p.rect(34, ty - 50, W - 68, 4, { fill: I })
  const tier = fitLine(p, (ctx.ticket.tierName || f.tierName).toUpperCase(), 'anton', 44, 20, 220)
  p.text(tier.text, 34, ty, { font: 'anton', size: tier.size, color: K })
  const price = fitLine(p, f.priceLine.toUpperCase(), 'anton', 44, 20, 220)
  p.text(price.text, W - 34, ty, { font: 'anton', size: price.size, color: K, align: 'right' })
  sponsorStrip(p, ctx, 1010, K)
  microtext(p, ctx, 34, 1106, W - 68, I)
  perforation(p, 1128, I)
  stub(p, ctx, 1146, { ink: K, muted: I, qrBox: null, serialFont: 'anton' })
}

/**
 * A stacked poster title: one word per line; a run of short words (≤ 3
 * letters) gets its own line ("FÊTE / DE LA / MUSIQUE"), a lone short word
 * joins the next one ("LE BAL"). At most 5 lines.
 */
function groupWords(_p: Painter, words: string[], _maxW: number): string[] {
  const lines: string[] = []
  let run: string[] = []
  const flushRun = (next?: string) => {
    if (run.length >= 2) {
      lines.push(run.join(' '))
      if (next) lines.push(next)
    } else if (run.length === 1) lines.push(next ? `${run[0]} ${next}` : run[0])
    else if (next) lines.push(next)
    run = []
  }
  for (const w of words) {
    if (Array.from(w).length <= 3) run.push(w)
    else flushRun(w)
  }
  if (run.length) {
    if (run.length === 1 && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1]} ${run[0]}`
    else flushRun()
  }
  if (lines.length > 5) return [...lines.slice(0, 4), lines.slice(4).join(' ')]
  return lines.length ? lines : ['']
}

/** Clip a polygon to x0 ≤ x ≤ x1 (Sutherland–Hodgman on two vertical edges). */
function clipX(poly: Array<[number, number]>, x0: number, x1: number): Array<[number, number]> {
  const clip = (pts: Array<[number, number]>, inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: Array<[number, number]> = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (inside(a)) {
        out.push(a)
        if (!inside(b)) out.push(cut(a, b))
      } else if (inside(b)) out.push(cut(a, b))
    }
    return out
  }
  const at = (x: number) => (a: [number, number], b: [number, number]): [number, number] => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]
  return clip(clip(poly, (q) => q[0] >= x0, at(x0)), (q) => q[0] <= x1, at(x1))
}

// ── 6. vèvè border ───────────────────────────────────────────────────────────

function drawVeveBorder(p: Painter, ctx: DrawContext) {
  const V = ctx.swatch.hex
  const ink = '#1A1A1A'
  const f = ctx.facts
  const L = ctx.labels
  const o = 18
  const bottom = 1096
  // Double rule frame.
  p.rect(o, o, W - 2 * o, bottom - o, { stroke: V, lw: 1.2 })
  p.rect(o + 8, o + 8, W - 2 * o - 16, bottom - o - 16, { stroke: V, lw: 0.6 })
  // Corner vèvè and edge diamonds.
  for (const [cx, cy] of [[o, o], [W - o, o], [o, bottom], [W - o, bottom]] as const) veve(p, cx - 26, cy - 26, 52, V, 1)
  for (let yy = 120; yy < bottom - 80; yy += 48) {
    for (const xx of [o + 4, W - o - 4]) p.path([['M', xx, yy - 6], ['L', xx + 4, yy], ['L', xx, yy + 6], ['L', xx - 4, yy], ['Z']], { fill: V })
  }
  for (let xx = 96; xx < W - 80; xx += 48) {
    for (const yy of [o + 4, bottom - 4]) p.path([['M', xx - 6, yy], ['L', xx, yy - 4], ['L', xx + 6, yy], ['L', xx, yy + 4], ['Z']], { fill: V })
  }

  wordmark(p, W / 2, 92, 34, ink, V, 'center')
  p.text(`${L.admit} · ${L.numberSign} ${serialNumberPart(ctx.ticket.serial)}`, W / 2, 112, { font: 'sansBold', size: 11, color: ink, align: 'center', charSpace: 3.3 })
  veve(p, W / 2 - 100, 140, 200, V, 1.4, V)

  const title = fitBlock(p, f.title, 'serifItalic', 62, 30, W - 2 * o - 60, 3)
  let y = 380 + title.size * 0.75
  for (const line of title.lines) {
    p.text(line, W / 2, y, { font: 'serifItalic', size: title.size, color: ink, align: 'center' })
    y += title.size * 0.98
  }
  // Ornament rule.
  y += 6
  p.line(90, y, W / 2 - 14, y, { stroke: V, lw: 1 })
  p.line(W / 2 + 14, y, W - 90, y, { stroke: V, lw: 1 })
  p.path([['M', W / 2, y - 7], ['L', W / 2 + 7, y], ['L', W / 2, y + 7], ['L', W / 2 - 7, y], ['Z']], { stroke: V, lw: 1 })

  y = Math.max(y + 50, 640)
  const colW = (W - 2 * o - 40) / 3
  ;[
    [L.date, f.dayShort],
    [L.time, f.time],
    [L.category, ctx.ticket.tierName || f.tierName],
  ].forEach(([label, value], i) => {
    const cx = o + 20 + colW * i + colW / 2
    p.text(label, cx, y, { font: 'sansBold', size: 10, color: V, align: 'center', charSpace: 2 })
    const v = fitLine(p, value, 'sansBold', 18, 10, colW - 8)
    p.text(v.text, cx, y + 24, { font: 'sansBold', size: v.size, color: ink, align: 'center' })
  })
  y += 62
  const where = fitBlock(p, [f.venueLine, f.phone].filter(Boolean).join(' · '), 'sans', 15, 11, W - 2 * o - 60, 2)
  for (const line of where.lines) {
    p.text(line, W / 2, y, { font: 'sans', size: where.size, color: '#3A3A3A', align: 'center' })
    y += where.size * 1.35
  }
  y += 40
  const price = fitLine(p, f.priceLine, 'serifItalic', 52, 26, W - 200)
  p.text(price.text, W / 2, y, { font: 'serifItalic', size: price.size, color: ink, align: 'center' })
  guilloche(p, y + 30, mix(V, '#FFFFFF', 0.25), { lines: 3, gap: 10, x0: o + 10, x1: W - o - 10, amp: 8, period: 120 })
  sponsorStrip(p, ctx, Math.max(y + 80, 960), ink, { x0: o + 24, x1: W - o - 24, center: true })
  microtext(p, ctx, o + 16, 1072, W - 2 * o - 32, V)
  perforation(p, 1128, V, { dotted: true })
  stub(p, ctx, 1146, { ink, muted: V, qrBox: null, serialFont: 'sansBold' })
}

// ── backs (duplex) ───────────────────────────────────────────────────────────

/** "Comment fonctionne ce billet": the back of every template, in its ink. */
export function drawBack(p: Painter, ctx: DrawContext) {
  const t = ctx.template.id
  const ink = '#111111'
  const accent =
    t === 'coloured_card' ? '#141414' : t === 'kraft_foil' ? '#1B1712' : t === 'poster_photo' ? (luminance(ctx.swatch.hex) > 0.6 ? '#111111' : ctx.swatch.hex) : ctx.swatch.hex
  const L = ctx.labels
  const stock = ctx.template.swatchRole === 'stock'
  if (t === 'kraft_foil') {
    foilFrame(p, 16)
    p.rect(16, 16, W - 32, H - 32, { fill: ctx.swatch.hex })
  }
  wordmark(p, W / 2, 92, 40, ink, stock ? undefined : accent, 'center')
  const head = fitBlock(p, L.howTitle.toUpperCase(), 'sansBold', 15, 11, W - 100, 2, 2.6)
  let y = 150
  for (const line of head.lines) {
    p.text(line, W / 2, y, { font: 'sansBold', size: head.size, color: accent, align: 'center', charSpace: 2.6 })
    y += head.size * 1.5
  }
  y += 24
  L.steps.forEach((step, i) => {
    p.text(String(i + 1), 50, y + 28, { font: 'serifItalic', size: 46, color: accent })
    const lines = wrapWords(p, step, 'sans', 18, W - 100 - 50)
    let ly = y + 16
    for (const line of lines) {
      p.text(line, 100, ly, { font: 'sans', size: 18, color: ink })
      ly += 26
    }
    y = Math.max(ly, y + 60) + 22
  })
  veve(p, W / 2 - 140, Math.max(y + 10, 600), 280, stock ? mix('#141414', '#FFFFFF', 0.25) : '#C9C9C9', 1.2, stock ? undefined : accent)
  y = 960
  for (const line of wrapWords(p, L.finePrint, 'sans', 14, W - 100)) {
    p.text(line, W / 2, y, { font: 'sans', size: 14, color: '#4A4A4A', align: 'center' })
    y += 20
  }
  p.text(L.support, W / 2, y + 16, { font: 'sansBold', size: 15, color: ink, align: 'center' })
  microtext(p, ctx, 34, 1106, W - 68, stock ? '#141414' : '#8A8A8A')
  perforation(p, 1128, stock ? '#141414' : '#9A9A9A', { lw: 1.5 })

  // Stub back: tear here, the serial again, keep this.
  p.text(L.tearHere.toUpperCase(), W / 2, 1192, { font: 'sansBold', size: 12, color: '#5C5C5C', align: 'center', charSpace: 2.6 })
  scissors(p, W / 2 - 12, 1210, 24, '#5C5C5C')
  p.text(ctx.ticket.serial, W / 2, 1272, { font: 'anton', size: 28, color: ink, align: 'center' })
  p.text(L.keep, W / 2, 1300, { font: 'sans', size: 13, color: '#5C5C5C', align: 'center' })
}

function scissors(p: Painter, x: number, y: number, size: number, color: string) {
  const k = size / 24
  const P = (px: number, py: number): [number, number] => [x + px * k, y + py * k]
  p.circle(...P(6, 6), 3 * k, { stroke: color, lw: 1.5 })
  p.circle(...P(6, 18), 3 * k, { stroke: color, lw: 1.5 })
  p.line(...P(20, 4), ...P(8.1, 15.9), { stroke: color, lw: 1.5, cap: 'round' })
  p.line(...P(14.5, 14.5), ...P(20, 20), { stroke: color, lw: 1.5, cap: 'round' })
  p.line(...P(8.1, 8.1), ...P(12, 12), { stroke: color, lw: 1.5, cap: 'round' })
}

const DRAW: Record<TemplateId, (p: Painter, ctx: DrawContext) => void> = {
  coloured_card: drawColouredCard,
  kraft_foil: drawKraftFoil,
  clean_white: drawCleanWhite,
  poster_photo: drawPosterPhoto,
  bold_type: drawBoldType,
  veve_border: drawVeveBorder,
}

/** Draw one ticket's front in the artboard. */
export function drawFront(p: Painter, ctx: DrawContext) {
  DRAW[ctx.template.id](p, ctx)
}
