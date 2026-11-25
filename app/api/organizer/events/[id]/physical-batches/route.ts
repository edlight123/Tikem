import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess, teamCol } from '@/lib/organizer/context'
import { quoteBatch } from '@/lib/physical/config'
import { cancelUnpaidBatch, createBatch, loadEventBatches, loadPhysicalConfig, type PayMethod } from '@/lib/physical/batches'
import { CardFxUnavailableError, startCardBatchPayment, startMonCashBatchPayment } from '@/lib/physical/payments'
import { canUseBalance, loadOffsetCandidates, payBatchFromBalance } from '@/lib/physical/balanceOffset'
import { consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Printed tickets for one event (lib/physical).
 *
 * GET   the live price list, the event's batches with their counts (printed /
 *       activated / checked in / voided, per seller) and the team members a
 *       range can be assigned to.
 *       For the owner / a finance admin, also the largest RELEASED HTG balance
 *       a single event holds (what "Pay from my Tikèm balance" can cover).
 * POST  { tierId, quantity, method: 'moncash' | 'card' | 'balance' } → order a
 *       batch: price from the live config, reserve the seats, start the upfront
 *       payment. Returns { batchId, redirectUrl } (or { batchId, paid: true }
 *       for a balance payment).
 *
 * The event's org (owner, admin, manager) or a platform admin.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  try {
    const [config, batches, team] = await Promise.all([
      loadPhysicalConfig(),
      loadEventBatches(eventId),
      gate.value.orgId ? teamCol(gate.value.orgId).get().catch(() => null) : Promise.resolve(null),
    ])
    // Pay from balance: only for who may spend it, and only released money.
    let balance: { canUse: boolean; availableHtg: number } = { canUse: false, availableHtg: 0 }
    if (gate.value.orgId && (await canUseBalance(gate.value.user, gate.value.orgId))) {
      const candidates = await loadOffsetCandidates(gate.value.orgId).catch(() => [])
      const best = candidates
        .filter((c) => c.currency === 'HTG' && !c.blocked)
        .reduce((m, c) => Math.max(m, c.availableNowMinor), 0)
      balance = { canUse: true, availableHtg: Math.floor(best / 100) }
    }
    const sellers = (team?.docs || [])
      .map((d: any) => ({ uid: d.id, ...(d.data() || {}) }))
      .filter((m: any) => m.status === 'active' && ['seller', 'manager', 'admin'].includes(String(m.role)))
      .map((m: any) => ({ uid: String(m.uid || m.id), name: String(m.name || m.email || ''), role: String(m.role) }))
    return NextResponse.json({ config, batches, sellers, balance })
  } catch (err: any) {
    console.error('[physical] list failed', { eventId, message: err?.message })
    return NextResponse.json({ error: 'Could not load printed tickets' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  const { user, event, orgId } = gate.value

  const body: any = await request.json().catch(() => ({}))
  const method: PayMethod = body?.method === 'card' ? 'card' : body?.method === 'balance' ? 'balance' : 'moncash'
  if (method === 'balance' && !(await canUseBalance(user, orgId || user.id))) {
    return NextResponse.json({ error: 'Only the owner or a finance admin can pay from the balance', code: 'balance_not_allowed' }, { status: 403 })
  }
  const quantity = Number(body?.quantity)
  const tierId = String(body?.tierId || '').trim()
  if (!tierId || tierId.includes('/')) return NextResponse.json({ error: 'Choose a ticket type', code: 'tier_required' }, { status: 400 })

  // Cheap refusal before touching inventory: the quote is what will be charged.
  const config = await loadPhysicalConfig()
  const quote = quoteBatch(config, quantity)
  if (!quote.ok) {
    return NextResponse.json({ error: 'This quantity cannot be ordered', code: quote.code, minBatch: quote.minBatch, maxBatch: quote.maxBatch }, { status: 400 })
  }

  const limit = await consumeRateLimit({ key: `physical:order:${orgId || user.id}`, limit: 20, windowMs: 24 * 60 * 60 * 1000 })
  if (limit.limited) return NextResponse.json({ error: 'Too many orders today. Try again tomorrow.', code: 'rate_limited' }, { status: 429 })

  const created = await createBatch({ eventId, event, orgId: orgId || user.id, tierId, quantity, method, createdBy: user.id })
  if (!created.ok) return NextResponse.json({ error: created.error, code: created.code, remaining: created.remaining ?? null }, { status: created.status })

  // Build the return URLs on the request's own host (apex → www redirects drop state).
  const origin = new URL(request.url).origin
  if (method === 'balance') {
    // Debited atomically from released money, or nothing happens.
    const paid = await payBatchFromBalance({ batch: created.batch, user })
    if (!paid.ok) {
      await cancelUnpaidBatch(created.batch.id, user.id, 'balance_refused').catch(() => null)
      return NextResponse.json({ error: paid.error, code: paid.code }, { status: paid.status })
    }
    return NextResponse.json({ batchId: created.batch.id, paid: true, totalHtg: created.batch.total_htg })
  }
  try {
    const started =
      method === 'moncash' ? await startMonCashBatchPayment(created.batch) : await startCardBatchPayment(created.batch, origin)
    return NextResponse.json({ batchId: created.batch.id, redirectUrl: started.redirectUrl, totalHtg: created.batch.total_htg })
  } catch (err: any) {
    // The payment could not start: give the seats back and say so.
    console.error('[physical] payment start failed', { batchId: created.batch.id, method, message: err?.message })
    await cancelUnpaidBatch(created.batch.id, user.id, 'payment_start_failed').catch(() => null)
    if (err instanceof CardFxUnavailableError) {
      return NextResponse.json({ error: err.message, code: 'fx_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'The payment could not be started. Nothing was charged.', code: 'payment_start_failed' }, { status: 502 })
  }
}
