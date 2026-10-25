import { NextRequest, NextResponse } from 'next/server'
import { requireOrg } from '@/lib/organizer/context'
import { adminDb } from '@/lib/firebase/admin'
import { getDeclaredMarkets, setDeclaredMarkets } from '@/lib/firestore/organizer-markets'
import { normalizeSupportedCountry } from '@/lib/country-support'
import { DECLARABLE_MARKETS, railsForMarkets } from '@/lib/organizer-markets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Declared markets — the countries an organizer says they'll run events in.
 *
 * This is a PREFERENCE endpoint, not a permission endpoint. What it returns
 * only decides which payout rails the UI leads with and how event-creation
 * country chips are ordered. The rail an event actually requires is still
 * derived server-side from the EVENT's country at publish and withdrawal time.
 */

async function statedDefaultCountry(userId: string): Promise<string> {
  try {
    const snap = await adminDb.collection('users').doc(userId).get()
    if (!snap.exists) return ''
    const data = snap.data() as any
    return normalizeSupportedCountry(data?.default_country || data?.country)
  } catch {
    return ''
  }
}

export async function GET(_request: NextRequest) {
  try {
    const org = await requireOrg('view')
    if (!org.ok) return org.response
    const orgId = org.value.orgId

    const markets = await getDeclaredMarkets(orgId)

    return NextResponse.json({
      markets,
      // Fallback signal for callers that need SOME ordering hint when nothing
      // has been declared. Never a substitute for a declaration.
      defaultCountry: (await statedDefaultCountry(orgId)) || null,
      rails: railsForMarkets(markets),
      options: DECLARABLE_MARKETS,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to load markets', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // The org's markets are an org setting: owner or team admin.
    const org = await requireOrg('manage_settings')
    if (!org.ok) return org.response

    const body = await request.json().catch(() => ({}))
    const submitted = Array.isArray(body?.markets) ? body.markets : null

    if (!submitted) {
      return NextResponse.json({ error: 'markets must be an array' }, { status: 400 })
    }

    // An empty list is valid and means "clear my declaration" — the organizer
    // goes back to seeing every rail. Never treated as "allow nothing".
    const markets = await setDeclaredMarkets(org.value.orgId, submitted)

    return NextResponse.json({ success: true, markets, rails: railsForMarkets(markets) })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to save markets', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}
