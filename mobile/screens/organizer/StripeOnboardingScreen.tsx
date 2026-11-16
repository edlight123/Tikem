import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import {
  ConnectComponentsProvider,
  loadConnectAndInitialize,
} from '@stripe/stripe-react-native'

import { useTheme } from '../../contexts/ThemeContext'
import { useI18n } from '../../contexts/I18nContext'
import { backendJson } from '../../lib/api/backend'

import { Touchable } from '../../components/ui/Touchable';
// DEEP import of the SDK's embedded-webview building block. On iOS the public
// ConnectAccountOnboarding wraps this in NativeConnectAccountOnboardingView, a
// native container inside which the content never painted on device (loader
// cleared, screen stayed black; the same webview contract works in a browser).
// Composing the block directly — the way the SDK itself renders it on Android,
// inside a plain RN view — bypasses that container while keeping the SDK's
// popup handling (openAuthenticatedWebView) intact. Pinned to the SDK version
// in package.json; revisit on any @stripe/stripe-react-native upgrade.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EmbeddedComponent } = require('@stripe/stripe-react-native/lib/module/connect/EmbeddedComponent') as {
  EmbeddedComponent: React.ComponentType<any>
}

type Params = {
  /** Forwarded to /connect for first-time account creation. */
  accountLocation?: 'united_states' | 'canada' | 'france'
  /** Debug switch: attempt the embedded component instead of the hosted flow. */
  tryEmbedded?: boolean
}

/**
 * Stripe Connect onboarding, embedded — Stripe's account-onboarding webview
 * on our own dark canvas, with the SDK handling the "necessary popups"
 * (Stripe user authentication) that a plain WebView drops.
 *
 * Flow: POST /connect {embedded:true} (creates the Express account if needed,
 * we ignore the returned page URL) → POST /account-session for the client
 * secret + publishable key → render the embedded component. Any failure — or
 * content that never announces itself — falls back to the Stripe-HOSTED
 * account link in the existing WebView screen, which is known to work.
 */
export default function StripeOnboardingScreen() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const insets = useSafeAreaInsets()

  const { accountLocation, tryEmbedded } = (route.params || {}) as Params

  const [connectInstance, setConnectInstance] = useState<ReturnType<
    typeof loadConnectAndInitialize
  > | null>(null)
  // goBack must run exactly once whether the user finishes, bails, or we fail
  // over — the native component can fire onExit after we've already left.
  const closedRef = useRef(false)
  const fallbackRef = useRef(false)
  // Watchdog: Stripe's embedded page fires onLoaderStart when content is
  // actually visible. A tester sat on an infinite spinner when the component
  // initialized but its inner page never came up (browser repro of the same
  // init contract works, so the stall is device-side) — never leave the
  // organizer stuck; fail over to the hosted flow instead.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const closeOnce = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    clearWatchdog()
    navigation.goBack()
  }, [clearWatchdog, navigation])

  // Hosted account link in the existing WebView — the pre-embedded flow.
  const fallbackToHosted = useCallback(async () => {
    if (fallbackRef.current || closedRef.current) return
    fallbackRef.current = true
    clearWatchdog()
    try {
      const res = await backendJson<{ url?: string }>('/api/organizer/stripe/connect', {
        method: 'POST',
        body: JSON.stringify(accountLocation ? { accountLocation } : {}),
      })
      if (res?.url && !closedRef.current) {
        closedRef.current = true
        navigation.replace('StripeConnectWebView', { url: res.url })
        return
      }
    } catch {
      // fall through to plain close
    }
    closeOnce()
  }, [accountLocation, clearWatchdog, closeOnce, navigation])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Hosted by default. Stripe's own docs settle it: for accounts where
      // STRIPE owns requirement collection — which is every Express account,
      // and Tikèm creates Express — embedded account onboarding REQUIRES the
      // connected account to authenticate in a Stripe-hosted WebView, and
      // disable_stripe_user_authentication is offered only to platform-liable
      // (Custom-style) accounts. That mandatory hosted step is exactly what
      // never paints in-app (black screen, reproduced locally on SDK 0.57 AND
      // 0.74, native container and plain-view composition alike). So there is
      // no fully-native onboarding to reach from here today; going straight to
      // the hosted flow spares organizers a 15s wait for a fallback that was
      // always coming. Pass tryEmbedded to exercise the embedded path.
      if (!tryEmbedded) {
        void fallbackToHosted()
        return
      }
      try {
        // Account bootstrap lives in /connect; embedded:true skips the hosted
        // account link. The page URL it returns is for the web flow — unused here.
        await backendJson('/api/organizer/stripe/connect', {
          method: 'POST',
          body: JSON.stringify({ ...(accountLocation ? { accountLocation } : {}), embedded: true }),
        })

        const session = await backendJson<{ clientSecret?: string; publishableKey?: string }>(
          '/api/organizer/stripe/account-session',
          { method: 'POST' }
        )
        if (cancelled) return
        if (!session?.clientSecret || !session?.publishableKey) {
          void fallbackToHosted()
          return
        }

        const instance = loadConnectAndInitialize({
          publishableKey: session.publishableKey,
          fetchClientSecret: async () => {
            const next = await backendJson<{ clientSecret?: string }>(
              '/api/organizer/stripe/account-session',
              { method: 'POST' }
            )
            if (!next?.clientSecret) throw new Error('No client secret')
            return next.clientSecret
          },
          // Same palette as the web page's Appearance config: near-black
          // surfaces, teal accent, white primary.
          appearance: {
            variables: {
              colorPrimary: '#14B8A6',
              colorBackground: '#0A0A0A',
              colorText: '#FFFFFF',
              colorSecondaryText: '#A3A3A3',
              colorBorder: '#262626',
              colorDanger: '#F87171',
              buttonPrimaryColorBackground: '#FFFFFF',
              buttonPrimaryColorText: '#0A0A0A',
            },
          } as any,
        })
        setConnectInstance(instance)
        // Content must announce itself (onLoaderStart) within this window or
        // we hand the organizer to the hosted flow instead of a dead spinner.
        watchdogRef.current = setTimeout(() => void fallbackToHosted(), 15000)
      } catch {
        if (!cancelled) void fallbackToHosted()
      }
    })()
    return () => {
      cancelled = true
      clearWatchdog()
    }
  }, [accountLocation, clearWatchdog, fallbackToHosted, tryEmbedded])

  const styles = getStyles(colors)
  // The SDK's inner spinner hid while content stayed invisible before, so we
  // keep our own overlay up until the page truly announces content.
  const [contentVisible, setContentVisible] = useState(false)

  const handleLoaderStart = useCallback(() => {
    clearWatchdog()
    setContentVisible(true)
  }, [clearWatchdog])

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <Touchable
          onPress={closeOnce}
          style={styles.headerButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Touchable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('screens.stripeConnect.title')}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.body}>
        {connectInstance ? (
          <NativeOnboardingBoundary onError={fallbackToHosted}>
            <ConnectComponentsProvider connectInstance={connectInstance}>
              <EmbeddedComponent
                component="account-onboarding"
                componentProps={{}}
                callbacks={{ onExit: closeOnce, onCloseWebView: closeOnce }}
                onLoaderStart={handleLoaderStart}
                onLoadError={() => void fallbackToHosted()}
                style={styles.embedded}
              />
            </ConnectComponentsProvider>
          </NativeOnboardingBoundary>
        ) : null}

        {!contentVisible ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.textSecondary} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

/**
 * If the installed binary somehow predates the SDK's Connect native view,
 * rendering it throws — catch that and fail over to the hosted flow instead
 * of crashing the screen.
 */
class NativeOnboardingBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 8,
      paddingBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    body: {
      flex: 1,
    },
    embedded: {
      flex: 1,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
  })
