import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin/audit-log'
import { DEFAULT_DOOR_TEAM_CONFIG, validateDoorTeamConfig } from '@/lib/doorTeam/config'
import { loadDoorTeamConfig, saveDoorTeamConfig } from '@/lib/doorTeam/requests'

export const dynamic = 'force-dynamic'

/**
 * Door team price list (Firestore config/door_team).
 * GET  platform admins: the live config and the defaults.
 * PUT  platform admins: replace it. Strictly validated (lib/doorTeam/config);
 *      every change is audited (admin_audit_log + config history: who / when /
 *      before / after).
 */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const config = await loadDoorTeamConfig()
  return NextResponse.json({ config, defaults: DEFAULT_DOOR_TEAM_CONFIG })
}

export async function PUT(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const body = await request.json().catch(() => null)
  const parsed = validateDoorTeamConfig(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field || null }, { status: 400 })
  try {
    const before = await loadDoorTeamConfig()
    const saved = await saveDoorTeamConfig(parsed.value, { uid: user.id, email: user.email || null })
    await logAdminAction({
      action: 'door_team.config.update',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: 'config/door_team',
      resourceType: 'config',
      details: { before, after: parsed.value },
    })
    return NextResponse.json({ config: saved })
  } catch (err: any) {
    console.error('[admin/door-team-config] save failed', { message: err?.message })
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
