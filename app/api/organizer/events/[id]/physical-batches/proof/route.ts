import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { consumeRateLimit } from '@/lib/rate-limit'
import { TEMPLATE_IDS, type TemplateId } from '@/lib/physical/design/registry'
import { proofInputFor, validateEventDesign } from '@/lib/physical/design/server'
import { renderProofPdf, renderProofs } from '@/lib/physical/design/proof'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/organizer/events/:id/physical-batches/proof
 *
 * { tierId, design, templates?: string[], backs?: boolean } → { proofs: [{ template, color, front, back? }] }
 *   SVG proofs drawn by the SAME code as the print PDF (lib/physical/design):
 *   the gallery asks for every template small; the proof step asks for the
 *   chosen one with its back.
 * { tierId, design, format: 'pdf', paper?: 'letter' | 'a4' } → a specimen sheet (PDF).
 *
 * Specimens only: serial 0001 and a QR that is not a ticket. The event's org
 * (manage_events) or a platform admin.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  const { user, event, orgId } = gate.value

  const limit = await consumeRateLimit({ key: `physical:proof:${user.id}`, limit: 600, windowMs: 60 * 60 * 1000, failOpen: true })
  if (limit.limited) return NextResponse.json({ error: 'Too many previews. Wait a moment.' }, { status: 429 })

  const body: any = await request.json().catch(() => ({}))
  const design = validateEventDesign(body?.design, eventId, event)
  if (!design.ok) return NextResponse.json({ error: design.error, code: design.code }, { status: 400 })
  const tierId = typeof body?.tierId === 'string' ? body.tierId : null

  try {
    const input = await proofInputFor({ eventId, event, orgId, tierId })
    if (body?.format === 'pdf') {
      const pdf = await renderProofPdf({
        input,
        design: { ...design.value, approved_at: null, approved_by: null },
        paper: body?.paper === 'a4' ? 'a4' : 'letter',
      })
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="tikem-proof.pdf"',
          'Cache-Control': 'no-store',
        },
      })
    }
    const asked: TemplateId[] = Array.isArray(body?.templates)
      ? (body.templates as unknown[]).filter((t): t is TemplateId => TEMPLATE_IDS.includes(t as TemplateId)).slice(0, TEMPLATE_IDS.length)
      : [design.value.template]
    const thumbs = asked.length > 1
    const proofs = await renderProofs({
      input,
      design: design.value,
      templates: asked.length ? asked : [design.value.template],
      backs: body?.backs === true && !thumbs,
      // Thumbnails are small; the proof is shown large on a sharp screen.
      dpi: thumbs ? 72 : 170,
    })
    return NextResponse.json({ proofs, lang: input.lang }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err: any) {
    console.error('[physical] proof failed', { eventId, message: err?.message })
    return NextResponse.json({ error: 'Could not draw the proof' }, { status: 500 })
  }
}
