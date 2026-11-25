import { NextRequest, NextResponse, after } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { publicDoorTeamConfig } from '@/lib/doorTeam/config'
import { createRequest, loadDoorTeamConfig, loadEventRequests } from '@/lib/doorTeam/requests'
import { organizerView, toDate } from '@/lib/doorTeam/rules'
import { notifyAdmins } from '@/lib/doorTeam/notify'
import { canUseBalance, largestReleasedHtg } from '@/lib/platformPay/balance'
import { consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Door team for one event (lib/doorTeam).
 *
 * GET   the live price list (standard quote inputs), the event's requests as
 *       the organizer may see them (crew first names only), the event start and,
 *       for the owner / a finance admin, the largest RELEASED HTG balance one
 *       event holds (what "Pay from my Tikèm balance" can cover).
 * POST  { staffCount, arrivalAt, hours, notes?, contactName, contactPhone }
 *       → a request, status 'requested', with the standard quote computed
 *       server-side from config/door_team. Nothing is charged yet.
 *
 * The event's org (owner, admin, manager) or a platform admin.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  const { user, orgId, event } = gate.value
  try {
    const [config, requests] = await Promise.all([loadDoorTeamConfig(), loadEventRequests(eventId)])
    let balance = { canUse: false, availableHtg: 0 }
    const open = requests.find((r) => r.status === 'quoted')
    if (open && orgId && (await canUseBalance(user, orgId))) {
      balance = { canUse: true, availableHtg: await largestReleasedHtg(orgId) }
    }
    const start = toDate(event?.start_datetime ?? event?.start_date)
    const end = toDate(event?.end_datetime ?? event?.end_date)
    return NextResponse.json({
      config: publicDoorTeamConfig(config),
      requests: requests.map(organizerView),
      event: { start: start ? start.toISOString() : null, end: end ? end.toISOString() : null },
      balance,
    })
  } catch (err: any) {
    console.error('[door-team] list failed', { eventId, message: err?.message })
    return NextResponse.json({ error: 'Could not load the door team' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const eventId = String((await params)?.id || '')
  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  const { user, event, orgId } = gate.value

  const limit = await consumeRateLimit({ key: `door-team:request:${orgId || user.id}`, limit: 10, windowMs: 24 * 60 * 60 * 1000 })
  if (limit.limited) return NextResponse.json({ error: 'Too many requests today. Try again tomorrow.', code: 'rate_limited' }, { status: 429 })

  const body: any = await request.json().catch(() => ({}))
  try {
    const created = await createRequest({
      eventId,
      event,
      orgId: orgId || user.id,
      createdBy: user.id,
      input: {
        staffCount: Number(body?.staffCount),
        arrivalAt: String(body?.arrivalAt || ''),
        hours: Number(body?.hours),
        notes: body?.notes == null ? '' : String(body.notes),
        contactName: String(body?.contactName || ''),
        contactPhone: String(body?.contactPhone || ''),
      },
    })
    if (!created.ok) return NextResponse.json({ error: created.error, code: created.code, field: created.field || null }, { status: created.status })
    after(() => notifyAdmins(created.request, 'requested'))
    return NextResponse.json({ request: organizerView(created.request) })
  } catch (err: any) {
    console.error('[door-team] request failed', { eventId, message: err?.message })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
