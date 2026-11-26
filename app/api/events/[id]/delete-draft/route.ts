import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { DRAFT_DELETE_MESSAGES } from '@/lib/events/draftDelete'
import { deleteDraftEvent, draftDeleteCheck } from '@/lib/events/draftDeleteServer'
import { logAdminAction } from '@/lib/admin/audit-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/events/[id]/delete-draft — delete a DRAFT that never sold.
 *
 *   GET   → { deletable, code }: may this draft be deleted, and if not, why
 *           (the app shows the action or its reason from this).
 *   POST  → deletes it. 409 with { code } when anything keeps it.
 *
 * For the event's OWN org (its organizer_id), with a role that runs events
 * (owner, admin, manager; lib/organizer/teamRoles), never the acting-org
 * header. Refused for anything published (those have Cancel), cancelled,
 * frozen, or that ever had a ticket, a printed batch, a door-team request, an
 * add-on sale, an order in flight, a seat hold or a money row
 * (lib/events/draftDelete + draftDeleteServer). Audit-logged.
 */
type Ctx = { params: Promise<{ id: string }> }

const statusFor = (code: string) => (code === 'not_found' ? 404 : 409)

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const gate = await requireEventAccess(id, 'manage_events')
    if (!gate.ok) return gate.response
    const code = await draftDeleteCheck(id, gate.value.event)
    return NextResponse.json({ deletable: code === null, code, error: code ? DRAFT_DELETE_MESSAGES[code] : null })
  } catch (err: any) {
    console.error('delete-draft check error:', err?.message || err)
    return NextResponse.json({ error: 'Could not check this draft.' }, { status: 500 })
  }
}

export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const gate = await requireEventAccess(id, 'manage_events')
    if (!gate.ok) return gate.response
    const { user, event, orgId, role } = gate.value

    const blocked = await draftDeleteCheck(id, event)
    if (blocked) {
      return NextResponse.json({ error: DRAFT_DELETE_MESSAGES[blocked], code: blocked }, { status: statusFor(blocked) })
    }

    const result = await deleteDraftEvent(id)
    if (!result.ok) {
      return NextResponse.json({ error: DRAFT_DELETE_MESSAGES[result.code], code: result.code }, { status: statusFor(result.code) })
    }

    await logAdminAction({
      action: 'event.draft_delete',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceId: id,
      resourceType: 'event',
      details: {
        eventTitle: event?.title || 'Untitled',
        organizerId: orgId,
        actorRole: role,
        removed: result.removed,
      },
    })

    return NextResponse.json({ ok: true, id })
  } catch (err: any) {
    console.error('delete-draft error:', err?.message || err)
    return NextResponse.json({ error: 'Could not delete this draft. Please try again.' }, { status: 500 })
  }
}
