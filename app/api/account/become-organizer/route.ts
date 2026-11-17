import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { updateUserRole } from '@/lib/firestore/user-profile-server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/become-organizer   { organizationName?, organizationLogo? }
 *
 * Turns the signed-in account into an organizer: the app's twin of the web's
 * "create your organization" step (app/organizer/actions.ts becomeOrganizer).
 * Publish-first: anyone may host, and identity checks happen at payout, so
 * there is no approval here. Called by the app
 *   - right after someone saves their first event (owner, 2026-11-17: an
 *     attendee published SANTA PIANO and then had no way into organizer mode),
 *   - from Profile > "Host events on Tikèm".
 *
 * Idempotent. Only ever upgrades an attendee: an organizer stays as is and an
 * admin is never touched (a downgrade must not be possible from here).
 */
export async function POST(request: Request) {
  const { user, error } = await requireAuth()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const role = String((user as any).role || 'attendee')
  let upgraded = false
  if (role === 'attendee') {
    const result = await updateUserRole(user.id, 'organizer')
    if (!result.success) {
      return NextResponse.json({ error: 'Could not set up organizer access' }, { status: 500 })
    }
    upgraded = true
  }

  // Optional brand details, same writer as the web step. Non-fatal: the role
  // is what unlocks organizer mode; the brand can be set later in settings.
  const orgName = typeof body?.organizationName === 'string' ? body.organizationName.trim().slice(0, 80) : ''
  const orgLogo = typeof body?.organizationLogo === 'string' ? body.organizationLogo.trim() : ''
  if (orgName || orgLogo) {
    try {
      const patch: Record<string, unknown> = {}
      if (orgName) patch.organization_name = orgName
      if (orgLogo) patch.organization_logo = orgLogo
      const { writeOrgBrandAdmin } = await import('@/lib/firestore/org-brand-server')
      await writeOrgBrandAdmin(user.id, patch, { organizers: true })
    } catch (e) {
      console.error('[become-organizer] brand details not saved', e)
    }
  }

  return NextResponse.json({ ok: true, role: role === 'attendee' ? 'organizer' : role, upgraded })
}
