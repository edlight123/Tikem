/**
 * Renders a PrefundingLetter (lib/payouts/prefunding-letter.ts) to a one-page
 * US Letter PDF on a text letterhead, with jsPDF's built-in Times / Helvetica
 * (WinAnsi: every French accent, « », ’ and – render without embedding a font).
 *
 * The signature area (left) and the company-seal area (right) are separate
 * boxes with a wide gap, so the seal is never stamped over the signature.
 * Server-only (jsPDF's node build); no I/O except the optional logo bytes the
 * caller passes in.
 */

import { jsPDF } from 'jspdf'
import type { PrefundingLetter } from '@/lib/payouts/prefunding-letter'

export type LetterLogo = { data: Uint8Array; format: 'PNG' | 'JPEG' }

const PAGE_W = 612 // US Letter, points
const PAGE_H = 792
const MARGIN_X = 72
const CONTENT_W = PAGE_W - MARGIN_X * 2
const INK = '#141414'
const MUTED = '#5b5b5b'
const FAINT = '#9a9a9a'

const BODY_SIZE = 11.5
const BODY_LEADING = 16.6

export function renderPrefundingLetterPdf(letter: PrefundingLetter, opts: { logo?: LetterLogo | null } = {}): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  doc.setProperties({
    title: `${letter.refLine.replace(/^Réf : /, '')} – ${letter.letterhead.companyName}`,
    subject: letter.ourRef,
    author: letter.letterhead.companyName,
    creator: letter.letterhead.companyName,
  })

  // ── Letterhead ──
  let x = MARGIN_X
  const top = 54
  if (opts.logo) {
    try {
      const props = doc.getImageProperties(opts.logo.data)
      const h = 40
      const w = Math.min(120, (props.width / props.height) * h)
      doc.addImage(opts.logo.data, opts.logo.format, MARGIN_X, top - 2, w, h)
      x = MARGIN_X + w + 14
    } catch {
      x = MARGIN_X // an unreadable logo never blocks the letter
    }
  }
  doc.setTextColor(INK)
  doc.setFont('times', 'bold')
  doc.setFontSize(22)
  doc.text(letter.letterhead.companyName.toUpperCase(), x, top + 20, { charSpace: 2.2 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.6)
  doc.setTextColor(MUTED)
  const sub = [letter.letterhead.addressLine, letter.letterhead.idsLine].filter(Boolean)
  const oneLine = sub.join('   ·   ')
  const subLines = doc.getTextWidth(oneLine) <= PAGE_W - MARGIN_X - x ? [oneLine] : sub
  subLines.forEach((line, i) => doc.text(line, x, top + 34 + i * 10, { charSpace: 0.3 }))

  const ruleY = Math.max(top + 46, top + 34 + (subLines.length - 1) * 10 + 10)
  doc.setDrawColor(INK)
  doc.setLineWidth(0.9)
  doc.line(MARGIN_X, ruleY, PAGE_W - MARGIN_X, ruleY)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_X, ruleY + 2.4, PAGE_W - MARGIN_X, ruleY + 2.4)

  // ── Date ──
  let y = ruleY + 58
  doc.setTextColor(INK)
  doc.setFont('times', 'normal')
  doc.setFontSize(BODY_SIZE)
  doc.text(letter.placeDate, PAGE_W - MARGIN_X, y, { align: 'right' })

  // ── Recipient ──
  y += 34
  letter.recipient.forEach((line, i) => {
    doc.setFont('times', i === 0 ? 'bold' : 'normal')
    doc.text(line, MARGIN_X, y)
    y += 15
  })

  // ── Réf ──
  y += 16
  doc.setFont('times', 'bold')
  doc.text(letter.refLine, MARGIN_X, y)
  const refLabelW = doc.getTextWidth('Réf')
  doc.setLineWidth(0.5)
  doc.line(MARGIN_X, y + 2, MARGIN_X + refLabelW, y + 2)
  y += 14
  doc.setFont('times', 'italic')
  doc.setFontSize(9.5)
  doc.setTextColor(MUTED)
  doc.text(letter.ourRef, MARGIN_X, y)

  // ── Body ──
  doc.setTextColor(INK)
  doc.setFontSize(BODY_SIZE)
  doc.setFont('times', 'normal')
  y += 30
  doc.text(letter.salutation, MARGIN_X, y)
  y += BODY_LEADING + 6

  const paragraph = (text: string) => {
    // Wrap by hand so a no-break space keeps "HTG 50 000,00" and "No. 188721"
    // on one line; it is then measured and drawn as a plain space (jsPDF
    // over-measures U+00A0). Justification is jsPDF's own (PDF word spacing,
    // last line ragged), so words are never placed absolutely and a viewer's
    // slightly different font metrics cannot make them collide.
    const space = doc.getTextWidth(' ')
    const units = text.split(' ').filter(Boolean).map((u) => u.replace(/ /g, ' '))
    const lines: string[] = []
    let current: string[] = []
    let used = 0
    for (const u of units) {
      const w = doc.getTextWidth(u)
      if (current.length && used + space + w > CONTENT_W) {
        lines.push(current.join(' '))
        current = []
        used = 0
      }
      used += (current.length ? space : 0) + w
      current.push(u)
    }
    if (current.length) lines.push(current.join(' '))
    doc.text(lines, MARGIN_X, y, {
      align: 'justify',
      maxWidth: CONTENT_W + 1,
      lineHeightFactor: BODY_LEADING / BODY_SIZE,
    })
    y += lines.length * BODY_LEADING
    y += 8
  }
  letter.paragraphs.forEach(paragraph)
  y += 4
  paragraph(letter.closing)

  // ── Signature (left) and seal (right): never overlapping ──
  const blockTop = Math.min(y + 26, PAGE_H - 220)
  const signW = 220
  const signSpace = 86 // blank room for the hand signature
  const lineY = blockTop + signSpace
  doc.setDrawColor(INK)
  doc.setLineWidth(0.6)
  doc.line(MARGIN_X, lineY, MARGIN_X + signW, lineY)

  doc.setFont('times', 'bold')
  doc.setFontSize(10.5)
  doc.text(letter.signature.label, MARGIN_X, lineY + 15)
  doc.setFont('times', 'normal')
  doc.setFontSize(BODY_SIZE)
  doc.text(letter.signature.name, MARGIN_X, lineY + 31)
  if (letter.signature.title) {
    doc.setFont('times', 'italic')
    doc.setFontSize(10.5)
    doc.text(letter.signature.title, MARGIN_X, lineY + 45)
  }

  const sealW = 150
  const sealH = 124
  const sealX = PAGE_W - MARGIN_X - sealW
  doc.setDrawColor(FAINT)
  doc.setLineWidth(0.6)
  doc.setLineDashPattern([3, 3], 0)
  doc.roundedRect(sealX, blockTop, sealW, sealH, 6, 6, 'S')
  doc.setLineDashPattern([], 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(FAINT)
  doc.text(letter.sealLabel.toUpperCase(), sealX + sealW / 2, blockTop + sealH - 10, { align: 'center', charSpace: 0.8 })

  return new Uint8Array(doc.output('arraybuffer'))
}

/**
 * Fetch the optional letterhead logo. Only https PNG / JPEG under 2 MB; any
 * failure returns null and the letter renders with the text letterhead alone.
 */
export async function fetchLetterLogo(url: string, fetchImpl: typeof fetch = fetch): Promise<LetterLogo | null> {
  if (!url) return null
  try {
    if (new URL(url).protocol !== 'https:') return null
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const type = String(res.headers.get('content-type') || '').toLowerCase()
    const format = type.includes('png') ? 'PNG' : type.includes('jpeg') || type.includes('jpg') ? 'JPEG' : null
    if (!format) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > 2_000_000) return null
    return { data: buf, format }
  } catch {
    return null
  }
}
