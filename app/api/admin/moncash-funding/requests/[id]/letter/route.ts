import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { loadPrefundingSettings, PREFUNDING_REQUESTS_COLLECTION } from '@/lib/payouts/prefunding-plan-server'
import { buildPrefundingLetter, type PrefundingLetterKind } from '@/lib/payouts/prefunding-letter'
import { fetchLetterLogo, renderPrefundingLetterPdf } from '@/lib/payouts/prefunding-letter-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET the formal letter for a logged prefunding request, as a PDF on the
 * company letterhead. Admin only. The amount, type, bank and transaction come
 * from the logged request; the letterhead, accounts and signatory from the
 * current settings (so a merchant number filled in later appears on a
 * re-download). The letter is dated the day it is downloaded (Haiti), since
 * Digicel wants the date it is sent. Read-only: sends nothing, moves nothing.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  const { id } = await params

  try {
    const snap = await adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).doc(id).get()
    if (!snap.exists) return adminError('Request not found', 404)
    const r = (snap.data() as any) || {}
    if (r.status === 'cancelled') return adminError('This request was cancelled; generate a new one.', 409)

    const { config } = await loadPrefundingSettings()
    const kind: PrefundingLetterKind = r.letterType === 'bank_transfer' ? 'bank_transfer' : 'merchant_transfer'
    const built = buildPrefundingLetter({
      kind,
      amountHtg: Number(r.amountHtg) || 0,
      at: new Date(),
      reference: String(r.reference || id),
      contacts: config.digicel,
      bankId: r.bank?.id || null,
      transactionNumber: r.transactionNumber || null,
    })
    if (!built.ok) return adminError(built.error, 409)

    const logo = await fetchLetterLogo(config.digicel.logoUrl)
    const pdf = renderPrefundingLetterPdf(built.letter, { logo })

    await logAdminAction({
      action: 'moncash.prefunding_letter.download',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: id,
      resourceType: 'prefunding_request',
      details: { kind, reference: r.reference || null, missing: built.letter.missing },
    })

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${built.letter.fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error('[admin/moncash-funding/requests/:id/letter] failed', e)
    return adminError('Failed to render the letter', 500, e?.message || String(e))
  }
}
