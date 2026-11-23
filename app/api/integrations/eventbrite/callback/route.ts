/**
 * GET: Eventbrite sends the organizer back here with a code. The state must
 * be the one this browser started with, for this same org and person, and
 * the person must STILL be allowed to manage the org's events (a role can
 * change between leaving and coming back). The code is swapped for a token
 * server-side and stored encrypted (lib/import/eventbrite-server).
 *
 * Always ends on /organizer/import?eventbrite=<connected|cancelled|error>,
 * which the app's integration WebView treats as "done, close".
 */
import { NextResponse, after } from 'next/server'
import { cookies } from 'next/headers'
import { getOrgContext } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'
import { EB_STATE_COOKIE, EB_STATE_PATH, eventbriteConfigured, exchangeCode, integrationOrigin, saveToken } from '@/lib/import/eventbrite-server'
import { syncEventbriteForOrg } from '@/lib/import/eventbrite-sync-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const u = new URL(req.url)
  const origin = integrationOrigin(req)
  const back = (q: 'connected' | 'cancelled' | 'error') => {
    const res = NextResponse.redirect(`${origin}/organizer/import?eventbrite=${q}`)
    res.cookies.delete({ name: EB_STATE_COOKIE, path: EB_STATE_PATH })
    return res
  }

  const ctx = await getOrgContext()
  if (!ctx || !orgCan(ctx.role, 'manage_events') || !eventbriteConfigured()) return back('error')
  const state = u.searchParams.get('state') || ''
  const expected = (await cookies()).get(EB_STATE_COOKIE)?.value || ''
  if (!state || state !== expected || !state.startsWith(`${ctx.orgId}.${ctx.user.id}.`)) return back('error')
  if (u.searchParams.get('error')) return back('cancelled')
  const code = u.searchParams.get('code')
  if (!code) return back('cancelled')

  const token = await exchangeCode(code, origin)
  if (!token) return back('error')
  await saveToken(ctx.orgId, token, ctx.user.id)
  // First sync right after the redirect is sent, so live events show up
  // without waiting for the daily run.
  const orgId = ctx.orgId
  after(() => syncEventbriteForOrg(orgId, { deadlineMs: 50_000 }).then(() => undefined).catch(() => undefined))
  return back('connected')
}
