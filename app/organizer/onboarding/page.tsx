import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import OnboardingClient from './OnboardingClient'
import { getPortalOrgContext } from '../_lib/orgPage'

/**
 * /organizer/onboarding — Stripe Connect EMBEDDED onboarding.
 *
 * Renders Stripe's account_onboarding component inside our own page instead of
 * bouncing the organizer to connect.stripe.com. Two consumers:
 *   - the web organizer dashboard (session-cookie auth), and
 *   - the mobile app's StripeConnectWebView, whose initial document request
 *     carries `Authorization: Bearer <firebase id token>` for trusted hosts.
 *
 * The bearer (when present) is passed to the client component IN MEMORY — not
 * a query param — so its account-session fetches can authenticate from inside
 * the WebView, where no session cookie exists.
 */
export default async function OrganizerOnboardingPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect(`/auth/login?redirect=${encodeURIComponent('/organizer/onboarding')}`)
  }

  // Stripe Connect is the org owner's (owner_only). A team member acting for
  // someone else's org goes back to the dashboard; an account with no org yet
  // keeps today's flow.
  const ctx = await getPortalOrgContext()
  if (ctx && !ctx.isOwner) redirect('/organizer')

  const headerStore = await headers()
  const authHeader = headerStore.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null

  return <OnboardingClient bearerToken={bearer} />
}
