'use client'

import { useTranslation } from 'react-i18next'

import { useMemo, useState } from 'react'
import { loadConnectAndInitialize } from '@stripe/connect-js'
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from '@stripe/react-connect-js'

/**
 * The client half of /organizer/onboarding: initializes Connect embedded
 * components and renders account onboarding inside the Tikèm canvas.
 *
 * `bearerToken` is non-null only inside the mobile WebView, whose page request
 * carried the Firebase ID token as a header; on the web the session cookie
 * authenticates the account-session fetches instead.
 */
export default function OnboardingClient({ bearerToken }: { bearerToken: string | null }) {
  const { t } = useTranslation('organizer')

  const [failed, setFailed] = useState<string | null>(null)

  const connectInstance = useMemo(() => {
    // 'use client' components still render once on the server; connect-js
    // touches the DOM, so initialization must wait for the browser.
    if (typeof window === 'undefined') return null
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!publishableKey) return null

    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => {
        const res = await fetch('/api/organizer/stripe/account-session', {
          method: 'POST',
          credentials: 'include',
          headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.clientSecret) {
          setFailed(data?.code === 'no_account' || data?.code === 'reconnect_needed' ? 'no_account' : 'error')
          throw new Error(data?.error || 'Failed to create account session')
        }
        return data.clientSecret
      },
      // Tikèm's canvas, straight from the design tokens: near-black surfaces,
      // teal as the sparing accent, the system's 12pt radius. Stripe controls
      // the component internals; these variables carry the rest of the way.
      appearance: {
        overlays: 'dialog',
        variables: {
          colorPrimary: '#14B8A6',
          colorBackground: '#161616',
          colorText: '#FFFFFF',
          colorSecondaryText: '#A3A3A3',
          colorBorder: '#262626',
          colorDanger: '#F87171',
          borderRadius: '12px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          buttonPrimaryColorBackground: '#FFFFFF',
          buttonPrimaryColorText: '#0A0A0A',
        },
      },
      fonts: [],
    })
  }, [bearerToken])

  if (!connectInstance) {
    return (
      <div style={wrap}>
        <p style={muted}>{t('onboarding.payments_not_configured')}</p>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={inner}>
        <h1 style={title}>{t('actions.set_up_payouts')}</h1>
        <p style={muted}>
          Verify your details and connect a bank account. Tikèm never sees your banking
          credentials, this step is secured by Stripe.
        </p>

        {failed === 'no_account' ? (
          <p style={errorText}>
            Your payout account hasn&apos;t been created yet. Go back and tap “Set up payouts”
            first.
          </p>
        ) : failed ? (
          <p style={errorText}>{t('onboarding.onboarding_failed')}</p>
        ) : (
          <ConnectComponentsProvider connectInstance={connectInstance}>
            <ConnectAccountOnboarding
              onExit={() => {
                // Same completion URL the hosted flow used: the web payout page
                // refreshes status from it, and the mobile WebView watches for
                // `stripe=return` and closes itself.
                window.location.assign('/organizer/settings/payouts?stripe=return')
              }}
            />
          </ConnectComponentsProvider>
        )}
      </div>
    </div>
  )
}

// Inline styles rather than a stylesheet: this page renders inside the mobile
// WebView too, and must not depend on dashboard layout CSS.
const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0A0A0A',
  color: '#FFFFFF',
  display: 'flex',
  justifyContent: 'center',
  padding: '24px 16px 48px',
}
const inner: React.CSSProperties = { width: '100%', maxWidth: 560 }
const title: React.CSSProperties = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  margin: '8px 0 6px',
}
const muted: React.CSSProperties = { color: '#A3A3A3', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }
const errorText: React.CSSProperties = { color: '#F87171', fontSize: 14 }
