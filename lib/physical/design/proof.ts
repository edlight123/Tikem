/**
 * Proofs: the organizer's live preview and the print room's "Download proof".
 *
 * The SVG proof and the print PDF are drawn by the SAME template code through
 * two painters (./painter.ts), so the proof the organizer approves is the
 * sheet that prints. A proof carries a specimen ticket: serial 0001 of the
 * batch-to-be and a QR that is not a ticket (it never scans in).
 *
 * Server only.
 */

import { SvgPainter } from './painter'
import { TICKET_LABELS, buildTicketFacts, type TicketFacts } from './facts'
import { getTemplate, swatchFor, type BatchDesign, type Lang, type TemplateId } from './registry'
import { drawBack, drawFront, type DrawContext } from './templates'
import { prepareDesignAssets, type DesignAssets } from './assets'
import { renderBatchPdf, ticketsPerPage, type PaperSize } from '../pdf'
import { formatSerial, serialPrefix } from '../rules'

/** What a specimen QR encodes: readable, and refused by every scanner (not a ticket payload). */
export const SPECIMEN_QR = 'TIKEM SPECIMEN - NOT A TICKET'

type ProofDesign = Pick<BatchDesign, 'template' | 'color' | 'photo_url' | 'logos' | 'overrides'>

export interface ProofEventInput {
  event: Record<string, any>
  tierName: string
  tierPrice: number
  currency?: string | null
  lang: Lang
  organizerName?: string | null
}

export function specimenSerials(event: Record<string, any>, tierName: string, count: number): string[] {
  const prefix = serialPrefix(String(event?.title || ''), tierName, 1)
  return Array.from({ length: count }, (_, i) => formatSerial(prefix, i + 1, Math.max(count, 100)))
}

export function proofFacts(input: ProofEventInput, design: ProofDesign): TicketFacts {
  return buildTicketFacts({
    event: input.event,
    tierName: input.tierName,
    tierPrice: input.tierPrice,
    currency: input.currency,
    lang: input.lang,
    overrides: design.overrides,
    organizerName: input.organizerName,
  })
}

/** One ticket (front, and back if asked) as standalone SVGs. */
export function drawProofSvg(params: {
  design: ProofDesign
  facts: TicketFacts
  lang: Lang
  assets: DesignAssets
  serial: string
  side: 'front' | 'back'
  idPrefix?: string
}): string {
  const template = getTemplate(params.design.template)!
  const swatch = swatchFor(template, params.design.color)
  const ctx: DrawContext = {
    template,
    swatch,
    facts: params.facts,
    labels: TICKET_LABELS[params.lang],
    ticket: { serial: params.serial, qrPayload: SPECIMEN_QR, tierName: params.facts.tierName },
    photo: params.assets.photo,
    logos: params.assets.logos,
  }
  const p = new SvgPainter()
  if (params.side === 'back') drawBack(p, ctx)
  else drawFront(p, ctx)
  const stock = template.swatchRole === 'stock'
  return p.toSvg({
    paper: stock ? swatch.hex : '#FFFFFF',
    multiply: stock,
    title: `${template.name[params.lang]} · ${swatch.name[params.lang]}`,
    idPrefix: params.idPrefix,
  })
}

/**
 * Proofs of several templates with the organizer's art: the gallery
 * thumbnails (each template in its own first colour unless it is the chosen
 * one) and the large proof of the chosen design (front and back).
 */
export async function renderProofs(params: {
  input: ProofEventInput
  design: ProofDesign
  templates: TemplateId[]
  backs: boolean
  dpi: number
}): Promise<Array<{ template: TemplateId; color: string; front: string; back?: string }>> {
  const [serial] = specimenSerials(params.input.event, params.input.tierName, 1)
  const out: Array<{ template: TemplateId; color: string; front: string; back?: string }> = []
  for (const id of params.templates) {
    const template = getTemplate(id)
    if (!template) continue
    const color = id === params.design.template ? swatchFor(template, params.design.color).id : template.swatches[0].id
    const design: ProofDesign = { ...params.design, template: id, color }
    const assets = await prepareDesignAssets(design, params.dpi)
    const facts = proofFacts(params.input, design)
    const front = drawProofSvg({ design, facts, lang: params.input.lang, assets, serial, side: 'front', idPrefix: `${id}f` })
    const back = params.backs ? drawProofSvg({ design, facts, lang: params.input.lang, assets, serial, side: 'back', idPrefix: `${id}b` }) : undefined
    out.push({ template: id, color, front, ...(back ? { back } : {}) })
  }
  return out
}

/** A one-page specimen sheet (front page + back page) of a design, as the print room would print it. */
export async function renderProofPdf(params: {
  input: ProofEventInput
  design: BatchDesign
  paper: PaperSize
  batchLabel?: string
}): Promise<Uint8Array> {
  const n = ticketsPerPage(params.paper)
  const serials = specimenSerials(params.input.event, params.input.tierName, n)
  const assets = await prepareDesignAssets(params.design, 300)
  return renderBatchPdf({
    design: params.design,
    facts: proofFacts(params.input, params.design),
    tickets: serials.map((serial) => ({ serial, qrPayload: SPECIMEN_QR, tierName: params.input.tierName })),
    assets,
    paper: params.paper,
    lang: params.input.lang,
    batchLabel: params.batchLabel,
    backs: true,
    specimen: true,
  })
}
