import { NextRequest, NextResponse } from 'next/server'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { toCsv } from '@/lib/csv'
import { requireFinanceView } from '@/lib/organizer/context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Read-only finances: the owner, or an admin the owner granted them.
    // The acting org's payouts, never the caller's own account.
    const gate = await requireFinanceView()
    if (!gate.ok) return gate.response
    const organizerId = gate.value.orgId

    // Get format from query params
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv'

    // Get all payouts (no limit for export)
    const payouts = await getPayoutHistory(organizerId, 1000)

    if (format === 'csv') {
      // Generate CSV
      const headers = ['Date', 'Amount', 'Method', 'Status', 'Scheduled Date', 'Completed Date', 'Failure Reason']
      const rows = payouts.map(p => [
        new Date(p.createdAt).toISOString(),
        (p.amount / 100).toFixed(2),
        p.method.replace('_', ' '),
        p.status,
        new Date(p.scheduledDate).toISOString(),
        p.completedAt ? new Date(p.completedAt).toISOString() : '',
        p.failureReason || '',
      ])

      const csv = toCsv([headers, ...rows])

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="payouts-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
  } catch (error: any) {
    console.error('Error exporting payouts:', error)
    return NextResponse.json(
      { error: 'Failed to export payouts', message: error.message },
      { status: 500 }
    )
  }
}
