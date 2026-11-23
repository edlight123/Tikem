/**
 * GET: send the organizer to Eventbrite to connect their account (OAuth).
 *
 * Web: a plain link (session cookie). App: opened in the integration WebView
 * on the www host with the Firebase Bearer token and the acting-org header
 * (mobile IntegrationWebViewScreen), so getOrgContext sees the same org.
 * Only someone who may manage the org's events can connect an account for
 * it; checked here and again on the way back (callback).
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getOrgContext } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'
import { EB_AUTHORIZE_URL, EB_STATE_COOKIE, EB_STATE_PATH, eventbriteConfigured, integrationOrigin, redirectUri } from '@/lib/import/eventbrite-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const origin = integrationOrigin(req)
  // The state cookie is host-bound and the callback runs on `origin`: start there too.
  if (new URL(req.url).host !== new URL(origin).host && process.env.VERCEL_ENV === 'production') {
    return NextResponse.redirect(`${origin}/api/integrations/eventbrite/start`)
  }
  const ctx = await getOrgContext()
  if (!ctx) return NextResponse.redirect(`${origin}/auth/login?redirect=${encodeURIComponent('/organizer/import')}`)
  if (!orgCan(ctx.role, 'manage_events')) return NextResponse.redirect(`${origin}/organizer/import?eventbrite=error`)
  if (!eventbriteConfigured()) return NextResponse.redirect(`${origin}/organizer/import?eventbrite=unavailable`)

  // One-time state bound to this browser (cookie), this org and this person.
  const state = `${ctx.orgId}.${ctx.user.id}.${randomBytes(16).toString('hex')}`
  const url = new URL(EB_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.EVENTBRITE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', redirectUri(origin))
  url.searchParams.set('state', state)
  const res = NextResponse.redirect(url.toString())
  res.cookies.set(EB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: EB_STATE_PATH,
    maxAge: 600,
  })
  return res
}
