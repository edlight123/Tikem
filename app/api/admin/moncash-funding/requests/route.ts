import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { loadPrefundingPlan, PREFUNDING_REQUESTS_COLLECTION } from '@/lib/payouts/prefunding-plan-server'
import { validateRequestAmount } from '@/lib/payouts/prefunding-plan'
import { prefundingRequestReference } from '@/lib/payouts/prefunding-email'
import {
  bankTransferDescription,
  buildPrefundingCoverEmail,
  buildPrefundingLetter,
  findDigicelBank,
} from '@/lib/payouts/prefunding-letter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  choice: z.enum(['minimum', 'recommended', 'custom']),
  amountHtg: z.number().optional(),
  letterType: z.enum(['merchant_transfer', 'bank_transfer']).default('merchant_transfer'),
  bankId: z.string().max(40).optional().nullable(),
  transactionNumber: z.string().max(60).optional().nullable(),
})

/** A bank top-up adds outside money, so only the amount's shape is checked (not the plan's maximum). */
const MAX_BANK_TRANSFER_HTG = 100_000_000

/**
 * GENERATE a Digicel prefunding request, as one of two letters
 * (lib/payouts/prefunding-letter.ts):
 *  - merchant_transfer: debit the MonCash merchant account, credit PREFUNDED;
 *  - bank_transfer: money was wired to a Digicel bank account (bank + transaction
 *    number from the receipt), credit PREFUNDED.
 *
 * Recomputes the plan server-side (the amount the browser shows may be stale),
 * validates the amount, logs the request in `prefunding_requests` and returns
 * the cover email. The letter itself is GET …/requests/:id/letter (PDF).
 * NOTHING is sent and NO money moves here.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return adminError('Invalid request body', 400, 'Send { choice, amountHtg?, letterType, bankId?, transactionNumber? }.')
  const { letterType } = parsed.data
  const isBank = letterType === 'bank_transfer'

  try {
    const now = new Date()
    const { plan, config } = await loadPrefundingPlan({ now })

    const blocking = plan.warnings.find((w) => w.blocking)
    if (blocking) return adminError(blocking.message, 409)

    const { choice } = parsed.data
    let amountHtg: number
    if (isBank && choice === 'custom') {
      amountHtg = Number(parsed.data.amountHtg)
      if (!(Number.isInteger(amountHtg) && amountHtg > 0 && amountHtg <= MAX_BANK_TRANSFER_HTG)) {
        return adminError('Enter the amount wired, in whole gourdes.', 400)
      }
    } else if (choice === 'minimum') {
      amountHtg = plan.minimum.amountHtg
      if (!isBank && amountHtg > plan.maximum.amountHtg) {
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
    const letterInput = {
      kind: letterType,
      amountHtg,
      at: now,
      reference,
      contacts: config.digicel,
      bankId: isBank ? parsed.data.bankId || null : null,
      transactionNumber: isBank ? (parsed.data.transactionNumber || '').trim() : null,
    }
    const built = buildPrefundingLetter(letterInput)
    if (!built.ok) return adminError(built.error, 400)
    const email = buildPrefundingCoverEmail({ ...letterInput, letter: built.letter })
    const bank = isBank ? findDigicelBank(parsed.data.bankId) : null

    await ref.set({
      reference,
      amountHtg,
      currency: 'HTG',
      choice,
      letterType,
      bank: bank ? { id: bank.id, bank: bank.bank, accountName: bank.accountName, accountNumber: bank.accountNumber } : null,
      transactionNumber: letterInput.transactionNumber,
      transferDescription: isBank ? bankTransferDescription(config.digicel.companyName) : null,
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
      details: { amountHtg, choice, reference, letterType, bank: bank?.id || null, transactionNumber: letterInput.transactionNumber },
    })

    return adminOk({
      request: {
        id: ref.id,
        reference,
        amountHtg,
        status: 'generated',
        createdAt: now.toISOString(),
        letterType,
        bankName: bank?.bank || null,
        transactionNumber: letterInput.transactionNumber,
      },
      email,
      letter: {
        fileName: built.letter.fileName,
        missing: built.letter.missing,
        url: `/api/admin/moncash-funding/requests/${ref.id}/letter`,
      },
    })
  } catch (e: any) {
    console.error('[admin/moncash-funding/requests] generate failed', e)
    return adminError('Failed to generate the request', 500, e?.message || String(e))
  }
}
