/**
 * The prefunding request log (`prefunding_requests`): one doc per Digicel
 * request an admin GENERATED. Tikèm never sends it; the admin does, then marks
 * it sent. It becomes completed only when the prefunded pool balance is seen
 * to rise above its baseline (balance when sent, else when generated) — by an
 * admin clicking "Mark completed" or by the 15-minute refresh cron.
 *
 * Pure transition rules, shared by the PATCH route and its tests.
 */

export type PrefundingRequestStatus = 'generated' | 'sent' | 'completed' | 'cancelled'

export type PrefundingRequestAction = 'sent' | 'completed' | 'cancelled'

export type PrefundingRequestDoc = {
  status: PrefundingRequestStatus
  amountHtg: number
  balanceAtGenerationHtg?: number | null
  balanceAtSentHtg?: number | null
}

export type TransitionResult =
  | { ok: true; updates: Record<string, any> }
  | { ok: false; status: number; error: string }

const ALLOWED: Record<PrefundingRequestStatus, PrefundingRequestAction[]> = {
  generated: ['sent', 'completed', 'cancelled'],
  sent: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

export function transitionPrefundingRequest(
  doc: PrefundingRequestDoc,
  action: PrefundingRequestAction,
  ctx: { now: Date; actorId: string; liveBalanceHtg: number | null }
): TransitionResult {
  const from = doc.status
  if (from === action) return { ok: true, updates: {} } // idempotent
  if (!ALLOWED[from]?.includes(action)) {
    return { ok: false, status: 409, error: `A ${from} request cannot be marked ${action}.` }
  }
  const at = ctx.now.toISOString()
  if (action === 'cancelled') {
    return { ok: true, updates: { status: 'cancelled', cancelledAt: at, cancelledBy: ctx.actorId, updatedAt: at } }
  }
  if (action === 'sent') {
    return {
      ok: true,
      updates: {
        status: 'sent',
        sentAt: at,
        sentBy: ctx.actorId,
        balanceAtSentHtg: ctx.liveBalanceHtg,
        updatedAt: at,
      },
    }
  }
  // completed: proven by the pool rising.
  if (ctx.liveBalanceHtg === null) {
    return { ok: false, status: 503, error: 'The prefunded balance could not be read, so the top-up cannot be confirmed yet.' }
  }
  const baseline = Number(doc.balanceAtSentHtg ?? doc.balanceAtGenerationHtg)
  if (!Number.isFinite(baseline)) {
    return { ok: false, status: 409, error: 'This request has no recorded starting balance to compare against.' }
  }
  if (!(ctx.liveBalanceHtg > baseline)) {
    return {
      ok: false,
      status: 409,
      error: `The pool has not risen yet: ${Math.round(baseline).toLocaleString('en-US')} HTG when sent, ${Math.round(
        ctx.liveBalanceHtg
      ).toLocaleString('en-US')} HTG now.`,
    }
  }
  return {
    ok: true,
    updates: {
      status: 'completed',
      completedAt: at,
      completedBy: ctx.actorId,
      confirmedVia: 'balance_rise',
      balanceAtCompletionHtg: ctx.liveBalanceHtg,
      updatedAt: at,
    },
  }
}
