import { NextResponse } from 'next/server'
import { normalizeCurrency } from '@/lib/money'
import { defaultCurrencyForCountry } from '@/lib/country-support'
import { getCurrentUser } from '@/lib/auth'
import { requireEventFinance } from '@/lib/organizer/financeAccess'
import { addOnSalesForEvent } from '@/lib/addons/server'
import { eventAddOns } from '@/lib/addons/addOns'

export const dynamic = 'force-dynamic'

/**
 * GET /api/organizer/events/:id/add-ons — the add-on sales summary for the
 * organizer dashboard (web + app): sold, picked up and face revenue per add-on
 * and option, from the event's live tickets, plus each add-on's stock.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    // Sales and revenue are finances: the same gate as the other per-event
    // finance routes (door staff use the pickup route, which has its own gate).
    const gate = await requireEventFinance(user, eventId)
    if (!gate.ok) return gate.response
    const event = gate.value.event

    const summary = await addOnSalesForEvent(eventId)
    const stock = eventAddOns(event as { add_ons?: unknown }).map((a) => ({ id: a.id, name: a.name, quantity: a.quantity ?? null }))
    return NextResponse.json({
      currency: normalizeCurrency(event.currency, defaultCurrencyForCountry(event.country)),
      ...summary,
      stock,
    })
  } catch (error) {
    console.error('[organizer/events/add-ons] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
