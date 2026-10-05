import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { liveTicketStatusesForQuery } from '@/lib/tickets/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily Statistics Rollup Cron Job
 * Calculates platform metrics for the previous day and stores in platform_stats_daily
 * 
 * This should be called daily via Vercel Cron or manually
 * Vercel Cron: Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/daily-stats",
 *     "schedule": "0 1 * * *"
 *   }]
 * }
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Calculate for yesterday
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    
    console.log(`Calculating daily stats for ${yesterdayStr}`)

    // Get all tickets purchased yesterday
    const ticketsSnapshot = await adminDb
      .collection('tickets')
      .where('purchased_at', '>=', yesterday)
      .where('purchased_at', '<', today)
      .where('status', 'in', liveTicketStatusesForQuery())
      .get()

    // Calculate GMV (Gross Merchandise Value)
    let gmvConfirmed = 0
    let ticketsConfirmed = 0

    ticketsSnapshot.forEach((doc: any) => {
      const data = doc.data()
      const pricePaid = data.price_paid || data.pricePaid || 0
      gmvConfirmed += pricePaid
      ticketsConfirmed++
    })

    // Get refunds for yesterday
    const refundsSnapshot = await adminDb
      .collection('tickets')
      .where('updated_at', '>=', yesterday)
      .where('updated_at', '<', today)
      .where('status', '==', 'refunded')
      .get()

    const refundsCount = refundsSnapshot.size
    let refundsAmount = 0

    refundsSnapshot.forEach((doc: any) => {
      const data = doc.data()
      const pricePaid = data.price_paid || data.pricePaid || 0
      refundsAmount += pricePaid
    })

    // Save rollup to platform_stats_daily
    await adminDb
      .collection('platform_stats_daily')
      .doc(yesterdayStr)
      .set({
        date: yesterdayStr,
        gmvConfirmed,
        ticketsConfirmed,
        refundsCount,
        refundsAmount,
        updatedAt: new Date()
      })

    console.log(`✅ Daily stats saved for ${yesterdayStr}:`, {
      gmvConfirmed,
      ticketsConfirmed,
      refundsCount,
      refundsAmount
    })

    return NextResponse.json({
      success: true,
      date: yesterdayStr,
      stats: {
        gmvConfirmed,
        ticketsConfirmed,
        refundsCount,
        refundsAmount
      }
    })

  } catch (error) {
    console.error('Error calculating daily stats:', error)
    return NextResponse.json(
      { 
        error: 'Failed to calculate daily stats',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request)
}
