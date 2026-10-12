import { NextResponse } from 'next/server'
import {
  convertUsdToHtgAmount,
  FX_RATE_UNAVAILABLE_CODE,
  FX_UNAVAILABLE_MESSAGES,
  getUsdToHtgRateWithSpread,
  isFxRateUnavailableError,
  requestLanguage,
} from '@/lib/fx/usd-htg'
import { MONCASH_USD_SPREAD } from '@/lib/moncash/price-order'
import { scheduleOpsEvent } from '@/lib/ops/ops-events'

export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const amountRaw = searchParams.get('amount')

    if (!amountRaw) {
      return NextResponse.json({ error: 'Missing amount' }, { status: 400 })
    }

    const amountUsd = Number(amountRaw)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Business rule: the same 5% spread MonCash checkout applies, on the same
    // hardened rate (live if sane, else the highest 14-day snapshot, else refuse).
    const quote = await getUsdToHtgRateWithSpread({ spreadPercent: MONCASH_USD_SPREAD })
    if (quote.source === 'snapshot_fallback') {
      scheduleOpsEvent('fx_snapshot_fallback', 'fx/usd-htg-quote', { baseRate: quote.baseRate })
    }
    const amountHtg = convertUsdToHtgAmount(amountUsd, quote.effectiveRate)

    return NextResponse.json({
      ...quote,
      amountUsd,
      amountHtg,
      chargeCurrency: 'HTG',
    })
  } catch (error: any) {
    if (isFxRateUnavailableError(error)) {
      scheduleOpsEvent('fx_rate_unavailable', 'fx/usd-htg-quote')
      return NextResponse.json(
        { error: FX_UNAVAILABLE_MESSAGES[requestLanguage(request)], code: FX_RATE_UNAVAILABLE_CODE },
        { status: 503 }
      )
    }
    console.error('FX quote error:', error)
    return NextResponse.json({ error: 'Failed to fetch exchange rate' }, { status: 500 })
  }
}
