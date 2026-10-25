import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireSuperAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { sendOpsEmail } from '@/lib/payouts/prefunding-alerts-server'
import { loadPrefundingSettings } from '@/lib/payouts/prefunding-plan-server'
import {
  DEFAULT_DIGICEL_PREFUNDING_CONTACTS,
  letterSettingsFromContacts,
  letterSettingsToDigicelPatch,
  parseLetterSettingsInput,
} from '@/lib/payouts/prefunding-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET the letterhead + Digicel settings the letter is built from (resolved, with defaults). */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  try {
    const { config } = await loadPrefundingSettings()
    return adminOk({
      settings: letterSettingsFromContacts(config.digicel),
      defaults: letterSettingsFromContacts(DEFAULT_DIGICEL_PREFUNDING_CONTACTS),
    })
  } catch (e: any) {
    console.error('[admin/moncash-funding/settings] read failed', e)
    return adminError('Failed to read the letter settings', 500, e?.message || String(e))
  }
}

/**
 * Fields printed on a money-movement letter or deciding where it is sent.
 * Changing one could redirect a transfer, so saves are super-admin only, the
 * audit log keeps before/after, and the ops list is emailed.
 */
const SENSITIVE_FIELDS = new Set([
  'merchantAccountNumber',
  'prefundedAccountNumber',
  'prefundedAccountName',
  'merchantAccountName',
  'to',
  'cc',
  'fromEmail',
  'signatoryName',
  'signatoryTitle',
  'companyName',
])

const escapeHtml = (v: unknown) =>
  String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * PUT the settings form. Validated in full (nothing saved unless every field
 * is valid), then merged into config/payouts.prefundingPlan.digicel; the rest
 * of config/payouts (prefunding, release rules…) is left untouched.
 */
export async function PUT(request: NextRequest) {
  // Super admin only: these values are printed on letters that move money.
  const { user, error } = await requireSuperAdmin()
  if (error || !user) return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)

  const parsed = parseLetterSettingsInput(await request.json().catch(() => null))
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, success: false, error: 'Some fields need fixing.', errors: parsed.errors }, { status: 400 })
  }

  try {
    const { config } = await loadPrefundingSettings()
    const patch = letterSettingsToDigicelPatch(parsed.value, config.digicel)
    await adminDb
      .collection('config')
      .doc('payouts')
      .set({ prefundingPlan: { digicel: patch } }, { merge: true })

    const before = letterSettingsFromContacts(config.digicel)
    const changed = (Object.keys(parsed.value) as Array<keyof typeof parsed.value>).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(parsed.value[k])
    )
    await logAdminAction({
      action: 'moncash.prefunding_settings.update',
      adminId: user.id,
      adminEmail: user.email || '',
      resourceId: 'config/payouts.prefundingPlan.digicel',
      resourceType: 'config',
      details: {
        changed,
        // Before/after for every changed field, so a redirected account is traceable.
        diff: Object.fromEntries(changed.map((k) => [k, { before: before[k], after: parsed.value[k] }])),
      },
    })

    const sensitive = changed.filter((k) => SENSITIVE_FIELDS.has(String(k)))
    if (sensitive.length) {
      const rows = sensitive
        .map((k) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(before[k])}</td><td>${escapeHtml(parsed.value[k])}</td></tr>`)
        .join('')
      await sendOpsEmail(
        `MonCash funding letter settings changed by ${user.email || user.id}`,
        `<p>${escapeHtml(user.email || user.id)} changed fields printed on Digicel funding letters. If this wasn't expected, check before sending any letter.</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Field</th><th>Before</th><th>After</th></tr>${rows}</table>`
      ).catch((e) => console.error('[admin/moncash-funding/settings] alert failed', e))
    }

    return adminOk({ settings: parsed.value, changed })
  } catch (e: any) {
    console.error('[admin/moncash-funding/settings] save failed', e)
    return adminError('Failed to save the letter settings', 500, e?.message || String(e))
  }
}
