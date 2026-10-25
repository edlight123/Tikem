import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { getDeclaredMarkets } from '@/lib/firestore/organizer-markets'
import { serializeData } from '@/lib/utils/serialize'
import { normalizeCountryCode } from '@/lib/payment-provider'
import PayoutsPageNew from './PayoutsPageNew'
import { isSmsConfigured } from '@/lib/sms'
import PayoutsPageWrapper from '@/components/organizer/payouts/PayoutsPageWrapper'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PayoutsSettingsPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise.
  searchParams?: Promise<{ stripe?: string; view?: string; edit?: string }>
}) {
  const sp = await searchParams
  const stripeParam = typeof sp?.stripe === 'string' ? sp.stripe : undefined
  const viewParam = typeof sp?.view === 'string' ? sp.view : undefined
  const editParam = typeof sp?.edit === 'string' ? sp.edit : undefined
  const payoutPath = `/organizer/settings/payouts${stripeParam ? `?stripe=${encodeURIComponent(stripeParam)}` : ''}`

  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect(`/auth/login?redirect=${encodeURIComponent(payoutPath)}`)
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect(`/auth/login?redirect=${encodeURIComponent(payoutPath)}`)
  }

  // Ensure this user is an organizer (attendees should go through the upgrade flow)
  let organizerDefaultCountry: string | undefined
  try {
    const userDoc = await adminDb.collection('users').doc(authUser.uid).get()
    const userData = userDoc.exists ? (userDoc.data() as any) : null
    const role = userData?.role || null
    if (role !== 'organizer') {
      redirect(`/organizer?redirect=${encodeURIComponent(payoutPath)}`)
    }

    const normalized = normalizeCountryCode(userData?.default_country || userData?.country)
    organizerDefaultCountry = normalized || undefined
  } catch (error) {
    console.error('Error checking user role:', error)
    redirect(`/organizer?redirect=${encodeURIComponent(payoutPath)}`)
  }

  // Fetch payout data + the organizer's declared markets. The markets are a UI
  // hint only: they decide which rails we lead with, never which rail an event
  // requires (that stays keyed off the EVENT's country, server-side).
  const [haitiConfig, stripeConfig, declaredMarkets] = await Promise.all([
    getPayoutProfile(authUser.uid, 'haiti'),
    getPayoutProfile(authUser.uid, 'stripe_connect'),
    getDeclaredMarkets(authUser.uid),
  ])

  // Serialize data
  const serializedHaitiConfig = serializeData(haitiConfig) || undefined
  const serializedStripeConfig = serializeData(stripeConfig) || undefined

  // Show advanced view (original complex page) if requested or editing
  if (viewParam === 'advanced' || editParam) {
    return (
      <div className="bg-[#0a0a0a]">
        <PayoutsPageNew
          haitiConfig={serializedHaitiConfig}
          stripeConfig={serializedStripeConfig}
          organizerId={authUser.uid}
          organizerDefaultCountry={organizerDefaultCountry}
          declaredMarkets={declaredMarkets}
          // Text-message codes only work with an SMS provider (none in
          // production yet); local dev logs the code instead.
          smsAvailable={isSmsConfigured() || process.env.NODE_ENV !== 'production'}
          initialActiveProfile={
            stripeParam
              ? 'stripe_connect'
              : editParam === 'stripe_connect'
                ? 'stripe_connect'
                : editParam === 'haiti'
                  ? 'haiti'
                  : undefined
          }
        />
      </div>
    )
  }

  // Show the new simplified wrapper by default
  return (
    <PayoutsPageWrapper
      haitiConfig={serializedHaitiConfig}
      stripeConfig={serializedStripeConfig}
      organizerId={authUser.uid}
      organizerDefaultCountry={organizerDefaultCountry}
      declaredMarkets={declaredMarkets}
      initialActiveProfile={stripeParam ? 'stripe_connect' : undefined}
    />
  )
}
