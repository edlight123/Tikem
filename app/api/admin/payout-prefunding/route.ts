import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireSuperAdmin } from '@/lib/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'

export async function POST(request: NextRequest) {
  try {
    // Turning prefunding on lets withdrawals pay out of Tikèm's own MonCash pool,
    // so it is a super-admin switch, like the prefunded transfer itself.
    const { user, error } = await requireSuperAdmin()
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const body = await request.json()
    const enabled = Boolean(body?.enabled)
    const available = Boolean(body?.available)

    await adminDb.collection('config').doc('payouts').set(
      {
        prefunding: {
          enabled,
          available,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: user.id,
        },
      },
      { merge: true }
    )

    await logAdminAction({
      action: 'payout.prefunding.update',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceType: 'config',
      resourceId: 'payouts',
      details: { enabled, available },
    })

    return adminOk({ success: true, prefunding: { enabled, available } })
  } catch (error: any) {
    console.error('admin payout-prefunding error:', error)
    return adminError('Failed to update prefunding status', 500, error?.message || String(error))
  }
}
