/**
 * API Route: Admin Platform Settings
 * 
 * GET: Retrieve current platform settings
 * PATCH: Update platform settings
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, requireAdmin } from '@/lib/auth'
import { getPlatformSettings, updatePlatformSettings } from '@/lib/admin/platform-settings'
import { DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'
import { logAdminAction } from '@/lib/admin/audit-log'

const ALLOWED_KEYS = new Set(['haiti', 'usCanada', 'minimumPayoutAmount'])
const MAX_HOLD_DAYS = 365

type RegionInput = { platformFeePercentage: number; settlementHoldDays: number }

/** Exactly the two known numeric fields, or an error message. Unknown keys are refused. */
function parseRegion(raw: unknown, label: string): { ok: true; value: RegionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${label} must be an object` }
  }
  const obj = raw as Record<string, unknown>
  const extra = Object.keys(obj).filter((k) => k !== 'platformFeePercentage' && k !== 'settlementHoldDays')
  if (extra.length) return { ok: false, error: `${label}: unknown field(s) ${extra.join(', ')}` }
  const fee = obj.platformFeePercentage
  const hold = obj.settlementHoldDays
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || fee > 1) {
    return { ok: false, error: `Invalid ${label} platform fee percentage (must be between 0 and 1)` }
  }
  if (typeof hold !== 'number' || !Number.isInteger(hold) || hold < 0 || hold > MAX_HOLD_DAYS) {
    return { ok: false, error: `Invalid ${label} settlement hold days (integer 0-${MAX_HOLD_DAYS})` }
  }
  return { ok: true, value: { platformFeePercentage: fee, settlementHoldDays: hold } }
}

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/settings
 * Retrieve current platform settings
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await requireAdmin()
    if (error) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const settings = await getPlatformSettings()

    return NextResponse.json({
      success: true,
      settings,
      defaults: DEFAULT_PLATFORM_SETTINGS,
    })
  } catch (error) {
    console.error('Error fetching platform settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch platform settings' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/settings
 * Update platform settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await requireAdmin()
    if (error) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
    if (unknownKeys.length) {
      return NextResponse.json({ error: `Unknown field(s): ${unknownKeys.join(', ')}` }, { status: 400 })
    }
    const { haiti, usCanada, minimumPayoutAmount } = body as Record<string, unknown>

    const updateData: Record<string, unknown> = {}
    if (haiti !== undefined) {
      const parsed = parseRegion(haiti, 'Haiti')
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      updateData.haiti = parsed.value
    }
    if (usCanada !== undefined) {
      const parsed = parseRegion(usCanada, 'US/Canada')
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      updateData.usCanada = parsed.value
    }
    if (minimumPayoutAmount !== undefined) {
      if (typeof minimumPayoutAmount !== 'number' || !Number.isFinite(minimumPayoutAmount) || minimumPayoutAmount < 0) {
        return NextResponse.json({ error: 'Invalid minimum payout amount (must be >= 0)' }, { status: 400 })
      }
      updateData.minimumPayoutAmount = minimumPayoutAmount
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No settings to update' }, { status: 400 })
    }

    const before = await getPlatformSettings().catch(() => null)
    const result = await updatePlatformSettings(updateData, user.id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update settings' },
        { status: 500 }
      )
    }

    // Fetch updated settings
    const updatedSettings = await getPlatformSettings()

    await logAdminAction({
      action: 'platform_settings.update',
      adminId: user.id,
      adminEmail: String(user.email || 'unknown'),
      resourceId: 'platform_settings',
      resourceType: 'settings',
      details: {
        changes: updateData,
        before: before
          ? {
              haiti: (before as any).haiti ?? null,
              usCanada: (before as any).usCanada ?? null,
              minimumPayoutAmount: (before as any).minimumPayoutAmount ?? null,
            }
          : null,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Platform settings updated successfully',
      settings: updatedSettings,
    })
  } catch (error) {
    console.error('Error updating platform settings:', error)
    return NextResponse.json(
      { error: 'Failed to update platform settings' },
      { status: 500 }
    )
  }
}
