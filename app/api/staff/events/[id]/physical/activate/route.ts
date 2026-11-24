import { NextResponse } from 'next/server'
import { requireSellerAccess } from '@/lib/physical/access'
import { activatePhysicalTicket } from '@/lib/physical/batches'
import { cleanHolderName } from '@/lib/physical/rules'

export const dynamic = 'force-dynamic'

/**
 * POST /api/staff/events/:id/physical/activate
 *
 * Sell one printed ticket: { code? (the scanned QR), serial? (typed),
 *   name (required), phone?, method? ('cash' default), amount?,
 *   clientRef? (offline queue id), clientActivatedAt?, offline? }
 *
 * Sellers (org role 'seller') may only activate tickets in the ranges assigned
 * to them; the event's owner / admins / managers may activate any. First
 * activation wins: a second gets ALREADY_ACTIVATED (with the holder's name),
 * a retry of the same queued activation (same clientRef) gets ok + alreadyDone.
 *
 * Like the check-in endpoint, every judged outcome is a 200 with ok + code, so
 * an offline queue can tell "refused" (drop it, tell the seller) from "retry"
 * (auth / server errors).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const gate = await requireSellerAccess(eventId)
    if (!gate.ok) return gate.response

    const body: any = await request.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 512) : ''
    const serial = typeof body?.serial === 'string' ? body.serial.trim().slice(0, 40) : ''
    if (!code && !serial) return NextResponse.json({ error: 'Scan the ticket or type its serial', code: 'code_required' }, { status: 400 })
    if (!cleanHolderName(body?.name)) {
      return NextResponse.json({ ok: false, code: 'NAME_REQUIRED', error: 'The buyer’s name is required' })
    }

    const result = await activatePhysicalTicket({
      eventId,
      code: code || null,
      serial: serial || null,
      input: { name: body?.name, phone: body?.phone, method: body?.method, amount: body?.amount },
      actor: gate.actor,
      clientRef: typeof body?.clientRef === 'string' ? body.clientRef : null,
      clientActivatedAt: typeof body?.clientActivatedAt === 'string' ? body.clientActivatedAt.slice(0, 40) : null,
      offline: body?.offline === true,
    })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[physical/activate] failed', { message: err?.message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
