import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin/audit-log'
import { DEFAULT_PHYSICAL_CONFIG, validatePhysicalConfig } from '@/lib/physical/config'
import { loadPhysicalConfig, savePhysicalConfig } from '@/lib/physical/batches'

export const dynamic = 'force-dynamic'

/**
 * Printed-ticket price list (Firestore config/physical_tickets).
 * GET  platform admins: the live config and the defaults.
 * PUT  platform admins: replace it. Strictly validated (lib/physical/config);
 *      every change is audited (admin_audit_log + config history: who / when /
 *      before / after).
 */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const config = await loadPhysicalConfig()
  return NextResponse.json({ config, defaults: DEFAULT_PHYSICAL_CONFIG })
}

export async function PUT(request: NextRequest) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const body = await request.json().catch(() => null)
  const parsed = validatePhysicalConfig(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field || null }, { status: 400 })
  try {
    const before = await loadPhysicalConfig()
    const saved = await savePhysicalConfig(parsed.value, { uid: user.id, email: user.email || null })
    await logAdminAction({
      action: 'physical_tickets.config.update',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: 'config/physical_tickets',
      resourceType: 'config',
      details: { before, after: parsed.value },
    })
    return NextResponse.json({ config: saved })
  } catch (err: any) {
    console.error('[admin/physical-config] save failed', { message: err?.message })
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
