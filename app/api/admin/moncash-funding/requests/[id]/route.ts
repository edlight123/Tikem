import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { PREFUNDING_REQUESTS_COLLECTION, readPoolBalance } from '@/lib/payouts/prefunding-plan-server'
import { transitionPrefundingRequest } from '@/lib/payouts/prefunding-requests'
import { gmailComposeUrl, mailtoUrl } from '@/lib/payouts/prefunding-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({ status: z.enum(['sent', 'completed', 'cancelled']) })

/** GET one logged request with its email, so a past request can be copied again. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  const { id } = await params
  const snap = await adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).doc(id).get()
  if (!snap.exists) return adminError('Request not found', 404)
  const { email: stored, ...rest } = (snap.data() as any) || {}
  const e = stored || {}
  const email = e.subject
    ? {
        to: e.to || [],
        cc: e.cc || [],
        from: e.from || '',
        subject: e.subject,
        body: e.body || '',
        gmailUrl: gmailComposeUrl({ to: e.to || [], cc: e.cc || [], subject: e.subject, body: e.body || '', from: e.from }),
        mailtoUrl: mailtoUrl({ to: e.to || [], cc: e.cc || [], subject: e.subject, body: e.body || '' }),
      }
    : null
  return adminOk({ request: { id, ...rest }, email })
}

/** Mark a request sent, completed (only once the pool has risen) or cancelled. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  const { id } = await params

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return adminError('Invalid request body', 400, "Send { status: 'sent' | 'completed' | 'cancelled' }.")
  const action = parsed.data.status

  try {
    const ref = adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return adminError('Request not found', 404)
    const { email: _email, ...doc } = (snap.data() as any) || {}

    const now = new Date()
    const live = action === 'sent' || action === 'completed' ? await readPoolBalance(now) : null
    const result = transitionPrefundingRequest(
      {
        status: doc.status || 'generated',
        amountHtg: Number(doc.amountHtg) || 0,
        balanceAtGenerationHtg: doc.balanceAtGenerationHtg ?? null,
        balanceAtSentHtg: doc.balanceAtSentHtg ?? null,
      },
      action,
      { now, actorId: user.id, liveBalanceHtg: live ? live.balanceHtg : null }
    )
    if (!result.ok) return adminError(result.error, result.status)
    if (Object.keys(result.updates).length) await ref.set(result.updates, { merge: true })

    await logAdminAction({
      action: 'moncash.prefunding_request.update',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: id,
      resourceType: 'prefunding_request',
      details: { from: doc.status, to: action, liveBalanceHtg: live?.balanceHtg ?? null },
    })

    return adminOk({ request: { id, ...doc, ...result.updates } })
  } catch (e: any) {
    console.error('[admin/moncash-funding/requests/:id] update failed', e)
    return adminError('Failed to update the request', 500, e?.message || String(e))
  }
}
