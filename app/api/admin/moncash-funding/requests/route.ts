import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { loadPrefundingPlan, PREFUNDING_REQUESTS_COLLECTION } from '@/lib/payouts/prefunding-plan-server'
import { validateRequestAmount } from '@/lib/payouts/prefunding-plan'
import { buildDigicelRequestEmail, prefundingRequestReference } from '@/lib/payouts/prefunding-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  choice: z.enum(['minimum', 'recommended', 'custom']),
  amountHtg: z.number().optional(),
})

/**
 * GENERATE a Digicel transfer request (merchant → PANTHEON SERVICES PREFUNDED).
 *
 * Recomputes the plan server-side (the amount the browser shows may be stale),
 * validates the amount against it, logs the request in `prefunding_requests`
 * and returns the French email for the admin to copy or open in Gmail.
 * NOTHING is sent and NO money moves here.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return adminError('Invalid request body', 400, 'Send { choice, amountHtg? }.')

  try {
    const now = new Date()
    const { plan, config } = await loadPrefundingPlan({ now })

    const blocking = plan.warnings.find((w) => w.blocking)
    if (blocking) return adminError(blocking.message, 409)

    const { choice } = parsed.data
    let amountHtg: number
    if (choice === 'minimum') {
      amountHtg = plan.minimum.amountHtg
      if (amountHtg > plan.maximum.amountHtg) {
        return adminError(
          `The minimum (${amountHtg.toLocaleString('en-US')} HTG) is more than can safely be moved now (${plan.maximum.amountHtg.toLocaleString('en-US')} HTG). Choose a custom amount up to the maximum.`,
          409
        )
      }
    } else if (choice === 'recommended') {
      amountHtg = plan.recommended.amountHtg
    } else {
      amountHtg = Number(parsed.data.amountHtg)
      const check = validateRequestAmount(amountHtg, plan)
      if (!check.ok) return adminError(check.error, 400)
    }
    if (!(amountHtg > 0)) return adminError('Nothing due: there is no amount to request right now.', 409)

    const ref = adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).doc()
    const reference = prefundingRequestReference(now, ref.id)
    const email = buildDigicelRequestEmail({ amountHtg, at: now, reference, contacts: config.digicel })

    await ref.set({
      reference,
      amountHtg,
      currency: 'HTG',
      choice,
      status: 'generated',
      createdAt: now.toISOString(),
      createdBy: user.id,
      createdByEmail: user.email || null,
      balanceAtGenerationHtg: plan.poolBalanceHtg,
      plan: {
        minimumHtg: plan.minimum.amountHtg,
        recommendedHtg: plan.recommended.amountHtg,
        maximumHtg: plan.maximum.amountHtg,
        warnings: plan.warnings.map((w) => w.code),
      },
      email: { to: email.to, cc: email.cc, from: email.from, subject: email.subject, body: email.body },
      updatedAt: now.toISOString(),
    })

    await logAdminAction({
      action: 'moncash.prefunding_request.generate',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: ref.id,
      resourceType: 'prefunding_request',
      details: { amountHtg, choice, reference },
    })

    return adminOk({ request: { id: ref.id, reference, amountHtg, status: 'generated', createdAt: now.toISOString() }, email })
  } catch (e: any) {
    console.error('[admin/moncash-funding/requests] generate failed', e)
    return adminError('Failed to generate the request', 500, e?.message || String(e))
  }
}
