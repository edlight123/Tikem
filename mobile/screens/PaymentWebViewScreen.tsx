import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { WebView } from 'react-native-webview'
import { useTheme } from '../contexts/ThemeContext';
import { auth } from '../config/firebase'
import { clearPendingPayment, setPendingPayment } from '../lib/pendingPayment'
import { setTicketsRefreshHint } from '../lib/ticketsRefreshHint'
import { requestPhonePrompt } from '../lib/phonePrompt'
import { useI18n } from '../contexts/I18nContext'
import { useAppMode } from '../contexts/AppModeContext'
import { PaymentSkeleton } from '../components/Skeleton'
import { useAppAlert } from '../components/AppAlert';
import { radius } from '../theme/tokens';

type Params = {
  url: string
  title?: string
  authToken?: string | null
  eventId?: string
}

// Digicel's hosted MonCash page (we 303-redirect to it from
// /api/moncash-button/checkout) ships a desktop-width layout and its number/PIN
// inputs are smaller than 16px. iOS therefore auto-zooms the page when a field
// is focused, which is what leaves the "Secure Payment" card pushed off-centre
// and clipped at the right edge. Their HTML is not ours to change, so we pin the
// viewport and normalise the input font size from this side instead.
//
// Deliberately conservative: no width/overflow rewriting of their layout. If
// their card is wider than the screen the user can still pan to reach it — the
// bug being fixed is the focus zoom, not the card's own width.
const FIT_VIEWPORT_JS = `
(function () {
  function pinViewport() {
    try {
      if (!document.head) return
      var meta = document.querySelector('meta[name="viewport"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute('name', 'viewport')
        document.head.appendChild(meta)
      }
      meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
      )

      if (!document.getElementById('tikem-no-focus-zoom')) {
        var style = document.createElement('style')
        style.id = 'tikem-no-focus-zoom'
        // 16px is the threshold below which iOS zooms into a focused field.
        style.textContent = 'input,select,textarea{font-size:16px !important}'
        document.head.appendChild(style)
      }
    } catch (e) {}
  }

  // Guarded like pinViewport's body: a document that can't be read must not
  // throw out of the injected script, or it takes the rest of the injection
  // (the card-reveal pass appended below) down with it.
  try {
    pinViewport()
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', pinViewport)
    }
  } catch (e) {}
})();
true;
`

// Second half of the same problem: with the viewport pinned, Digicel's card is
// now centred and unclipped but it LANDS about 40% down the viewport, behind a
// tall empty band, so the PIN field and the red Pay button sit under the
// keyboard until the user scrolls. We cannot edit their HTML and cannot load
// their live page to inspect it, so this pass is measurement-driven only:
//
//   1. find the card without relying on ANY of their class names,
//   2. scroll it to the top of the viewport (scrollIntoView, which also works
//      if their layout scrolls an inner wrapper rather than the document),
//   3. only if scrolling could not fix it — i.e. the band is layout, not
//      scrollable content — tighten measurably huge top padding/margins and
//      desktop-sized vertical centering on the card's own ancestors.
//
// Everything is wrapped so a throw can never block the page or undo the
// viewport pin above, it only ever pulls the card UP (never pushes it down, so
// it cannot fight iOS scrolling a focused field into view), and if the card
// cannot be found the page is left exactly as the server sent it.
const REVEAL_CARD_JS = `
(function () {
  try {
    var KEY = '__tikemRevealPayCard'
    // Runs twice (before-content + after-load). The second run reuses the
    // installed instance instead of wiring up a duplicate set of listeners.
    if (window[KEY]) {
      if (typeof window[KEY].run === 'function') window[KEY].run()
      return
    }

    var GAP = 12
    var MAX_ATTEMPTS = 8
    var attempts = 0
    var settled = false

    function viewportHeight() {
      try {
        var visual = window.visualViewport && window.visualViewport.height
        return (
          visual ||
          window.innerHeight ||
          (document.documentElement && document.documentElement.clientHeight) ||
          0
        )
      } catch (e) {
        return 0
      }
    }

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false
      var r = el.getBoundingClientRect()
      return r.height > 0 && r.width > 0
    }

    // Climb at most 3 levels to the outermost ancestor that still looks like a
    // card (not as tall as the page), so we align the card's own top edge —
    // heading included — rather than a bare input in the middle of it.
    function cardish(el) {
      var out = el
      var node = el
      var limit = viewportHeight() * 0.85
      for (var i = 0; i < 3; i++) {
        node = node.parentElement
        if (!node || node === document.body || node === document.documentElement) break
        var r = node.getBoundingClientRect()
        if (!r || r.height <= 0) break
        if (limit > 0 && r.height > limit) break
        out = node
      }
      return out
    }

    function findTarget() {
      if (!document.querySelectorAll) return null

      // 1. The checkout form itself — strongest signal, no class names involved.
      var forms = document.querySelectorAll('form')
      for (var i = 0; i < forms.length; i++) {
        if (isVisible(forms[i]) && forms[i].querySelector('input')) return cardish(forms[i])
      }

      // 2. No usable form: the first credential-ish field on the page.
      var field = document.querySelector(
        'input[type="password"],input[type="tel"],input[type="number"],input[type="text"]'
      )
      if (isVisible(field)) return cardish(field)

      // 3. Still nothing: a heading/label/button whose text reads like the card.
      var nodes = document.querySelectorAll('h1,h2,h3,h4,legend,label,button,[type="submit"]')
      for (var j = 0; j < nodes.length; j++) {
        var text = (nodes[j].textContent || '').trim()
        if (
          text &&
          text.length < 80 &&
          /(secure\\s*payment|payment|paiement|moncash|payer|peye)/i.test(text) &&
          isVisible(nodes[j])
        ) {
          return cardish(nodes[j])
        }
      }

      // 4. Give up. The page stays exactly as it is today: usable, scrollable.
      return null
    }

    // Returns true when the card's top is where we want it (or close enough).
    function align(el) {
      var top = el.getBoundingClientRect().top
      // Already at/above the top of the viewport: nothing to pull up, and we
      // must not push it back down.
      if (top <= GAP + 4) return true
      try {
        el.style.scrollMarginTop = GAP + 'px'
      } catch (e) {}
      try {
        el.scrollIntoView({ block: 'start', inline: 'nearest' })
      } catch (e2) {
        try {
          el.scrollIntoView(true)
        } catch (e3) {}
      }
      var height = viewportHeight()
      return el.getBoundingClientRect().top <= (height ? height * 0.25 : GAP + 4)
    }

    // Last resort, and only after align() proved the page cannot scroll far
    // enough: the band above the card is layout. Tighten only gaps we have
    // MEASURED as oversized, only via inline styles, and only on the vertical
    // axis so the horizontal centering that already works is left intact.
    function collapse(el) {
      var height = viewportHeight()
      if (!height || !window.getComputedStyle) return
      var node = el.parentElement
      for (var i = 0; i < 6 && node && node !== document.documentElement; i++) {
        if (node.getAttribute && node.getAttribute('data-tikem-tightened') !== '1') {
          var cs = window.getComputedStyle(node)
          if (cs) {
            if (parseFloat(cs.paddingTop) > 48) node.style.paddingTop = GAP + 'px'
            if (parseFloat(cs.marginTop) > 48) node.style.marginTop = GAP + 'px'
            var display = String(cs.display || '')
            var tall = node.getBoundingClientRect().height >= height * 0.9
            if (tall && display.indexOf('flex') >= 0) {
              var column = String(cs.flexDirection || 'row').indexOf('column') === 0
              // Vertical axis is justify-content in a column, align-items in a row.
              if (column && cs.justifyContent === 'center') node.style.justifyContent = 'flex-start'
              if (!column && cs.alignItems === 'center') node.style.alignItems = 'flex-start'
            } else if (tall && display.indexOf('grid') >= 0) {
              if (cs.alignItems === 'center') node.style.alignItems = 'start'
              if (cs.alignContent === 'center') node.style.alignContent = 'start'
            }
            if (node.setAttribute) node.setAttribute('data-tikem-tightened', '1')
          }
        }
        node = node.parentElement
      }
    }

    function reveal() {
      try {
        var el = findTarget()
        if (!el) return false
        if (align(el)) return true
        collapse(el)
        align(el)
        return true
      } catch (e) {
        return false
      }
    }

    function attempt() {
      if (settled) return
      attempts += 1
      if (reveal()) {
        settled = true
        return
      }
      // The card may not be in the DOM yet; back off and look again.
      if (attempts < MAX_ATTEMPTS) setTimeout(attempt, 150 * attempts)
    }

    function run() {
      if (settled) {
        reveal()
        return
      }
      attempt()
    }

    window[KEY] = { run: run }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run)
    }
    window.addEventListener('load', function () {
      setTimeout(run, 60)
    })
    // Focusing a field (and the keyboard resizing the visual viewport) can
    // shift the card back down — re-assert once things have settled.
    document.addEventListener(
      'focusin',
      function () {
        setTimeout(run, 300)
      },
      true
    )
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', function () {
        setTimeout(run, 250)
      })
    }

    run()
  } catch (e) {}
})();
true;
`

// Injected as one script: pin the viewport first (the fix that already works),
// then bring the payment card into view.
const PAGE_FIT_JS = FIT_VIEWPORT_JS + '\n' + REVEAL_CARD_JS

// Tells the screen the page's DOM is parsed — i.e. it can paint — so the loading
// skeleton can come off THEN, not at onLoadEnd. onLoadEnd waits for the window
// `load` event: every font, image and @import on the page. Digicel's MonCash page
// pulls Google Fonts via a CSS @import plus Font Awesome/Glyphicons webfonts, all
// served `Cache-Control: no-store` (re-downloaded on every visit), so on a Haitian
// mobile connection `load` lands well after the form is already usable. onLoadEnd
// stays wired up as the fallback if this message never arrives.
const PAGE_READY_JS = `
(function () {
  try {
    var sent = false
    function ready() {
      if (sent) return
      sent = true
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ source: 'tikem', type: 'page_ready' })
          )
      } catch (e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready)
    } else {
      ready()
    }
  } catch (e) {}
})();
true;
`

// Hosts we may attach the Firebase bearer to. The MonCash checkout page needs
// the token to render its form — if the host isn't trusted, the header is
// withheld and the page comes back BLANK (exactly the "stuck on a white page"
// bug). We trust our known production domains plus whatever backend the app is
// configured to call (the redirect always lives on our own backend). An
// untrusted/hijacked redirect target still never receives the token.
const TRUSTED_PAYMENT_HOSTS = new Set(
  [
    'tikem.co',
    'www.tikem.co',
    // The legacy *.vercel.app aliases are deliberately absent: production
    // canonicalizes them to www.tikem.co, and a backend pointed at one is still
    // trusted through EXPO_PUBLIC_API_URL below.
    (() => {
      try {
        return new URL(process.env.EXPO_PUBLIC_API_URL || '').host.toLowerCase()
      } catch {
        return ''
      }
    })(),
  ].filter(Boolean),
)

function isTrustedPaymentUrl(raw: string | undefined | null): boolean {
  if (!raw) return false
  try {
    const u = new URL(raw)
    // http only in a dev build, for a local backend.
    const secure = u.protocol === 'https:' || (__DEV__ && u.protocol === 'http:')
    return secure && TRUSTED_PAYMENT_HOSTS.has(u.host.toLowerCase())
  } catch {
    return false
  }
}

export default function PaymentWebViewScreen() {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const { url, authToken, title, eventId } = (route.params || {}) as Params
  const { t } = useI18n()
  const { mode, setMode } = useAppMode()

  // Host shown as a trust cue in the header (e.g. "tikem.co").
  const hostLabel = useMemo(() => {
    try {
      return new URL(url).host.replace(/^www\./, '')
    } catch {
      return ''
    }
  }, [url])

  const webViewRef = useRef<WebView>(null)
  const [loading, setLoading] = useState(true)
  const [handledTerminal, setHandledTerminal] = useState(false)
  const [failure, setFailure] = useState<{ reason?: string } | null>(null)
  const [resolvedAuthToken, setResolvedAuthToken] = useState<string | null>(authToken || null)

  // The Firebase ID token may ONLY be attached to our own trusted hosts, never
  // to an arbitrary redirect target — otherwise a hijacked/redirected checkout
  // URL could exfiltrate the bearer token to a third party.
  const isTrustedHost = useMemo(() => {
    try {
      const host = new URL(url).host.toLowerCase()
      return TRUSTED_PAYMENT_HOSTS.has(host)
    } catch {
      return false
    }
  }, [url])

  const needsAuthHeader = useMemo(() => {
    if (!url) return false
    // MonCash checkout endpoint requires auth to render the form — but only ever
    // send it to a trusted host.
    if (!isTrustedHost) return false
    return url.includes('/api/moncash-button/checkout') || url.includes('/api/moncash-button/initiate')
  }, [url, isTrustedHost])

  useEffect(() => {
    if (!url) return
    setPendingPayment({ url, title, eventId }).catch(() => {})
  }, [eventId, title, url])

  useEffect(() => {
    if (!needsAuthHeader) return
    if (resolvedAuthToken) return
    const current = auth.currentUser
    if (!current) return
    current
      .getIdToken()
      .then((t) => setResolvedAuthToken(t))
      .catch(() => setResolvedAuthToken(null))
  }, [needsAuthHeader, resolvedAuthToken])

  const finishWithSuccess = useCallback(() => {
    if (handledTerminal) return
    setHandledTerminal(true)

    clearPendingPayment().catch(() => {})
    setTicketsRefreshHint({ reason: 'payment', createdAt: Date.now() }).catch(() => {})

    showAlert(t('screens.payment.successTitle'), t('screens.payment.successBody'), [
      {
        text: t('common.ok'),
        onPress: () => {
          // Tickets lives only in the attendee tabs; from organizer/staff mode
          // switch modes and let the navigator land there.
          if (mode === 'attendee') {
            navigation.reset({
              index: 0,
              routes: [{ name: 'Main', params: { screen: 'Tickets' } }],
            })
          } else {
            setMode('attendee', { landingTab: 'Tickets' })
          }
          // "Add your number" (lib/phonePrompt.ts); the root host applies the policy.
          requestPhonePrompt({ trigger: 'post_purchase' })
        },
      },
    ])
  }, [handledTerminal, mode, navigation, setMode, t])

  const finishWithFailure = useCallback(
    (message?: string) => {
      if (handledTerminal) return
      setHandledTerminal(true)

      clearPendingPayment().catch(() => {})

      // Show a branded in-screen failure state instead of a bare alert. We keep
      // the user on the checkout screen so they can retry the same URL or exit.
      setFailure({ reason: message })
    },
    [handledTerminal]
  )

  // The gateway return routes report a machine code (`?reason=sold_out`). Showing
  // it raw put "Reason: amount_mismatch" in front of buyers; map the known codes
  // to translated copy and keep the raw code in the log for support.
  const failureReasonMessage = useCallback(
    (reason: string): string | undefined => {
      if (!reason) return undefined
      console.warn('[PaymentWebView] payment failed:', reason)
      const known = [
        'payment_failed',
        'sold_out',
        'capacity_exceeded',
        'amount_mismatch',
        'ticket_creation_failed',
        'missing_order',
        'missing_transaction',
        'transaction_not_found',
        'processing_error',
        // Sent by moncash-button/return and moncash/callback when a paid order is
        // flagged for refund or cannot be fulfilled.
        'refund_pending',
        'refused',
        'invalid_order',
      ]
      const code = reason.trim().toLowerCase()
      return known.includes(code)
        ? t(`screens.payment.reasons.${code}`)
        : t('screens.payment.reasons.generic')
    },
    [t]
  )

  const handleTryAgain = useCallback(() => {
    setFailure(null)
    setHandledTerminal(false)
    setLoading(true)
    // Retry the same checkout URL in the existing WebView.
    webViewRef.current?.reload()
  }, [])

  // Closing mid-payment could drop an in-flight ticket purchase, so confirm
  // first (unless the flow already reached a terminal success/failure).
  const handleRequestClose = useCallback(() => {
    if (handledTerminal) {
      navigation.goBack()
      return
    }
    showAlert(t('screens.payment.cancelTitle'), t('screens.payment.cancelBody'), [
      { text: t('screens.payment.cancelKeep'), style: 'cancel' },
      {
        text: t('screens.payment.cancelConfirm'),
        style: 'destructive',
        onPress: () => {
          clearPendingPayment().catch(() => {})
          navigation.goBack()
        },
      },
    ])
  }, [handledTerminal, navigation, t])

  const onNavChange = useCallback(
    (nextUrl: string) => {
      if (!nextUrl || handledTerminal) return

      // Our backend redirects to these pages on terminal outcomes.
      if (nextUrl.includes('/purchase/success')) {
        finishWithSuccess()
        return
      }

      if (nextUrl.includes('/purchase/failed')) {
        const reason = (() => {
          try {
            const parsed = new URL(nextUrl)
            return parsed.searchParams.get('reason') || ''
          } catch {
            return ''
          }
        })()
        finishWithFailure(failureReasonMessage(reason))
      }
    },
    [failureReasonMessage, finishWithFailure, finishWithSuccess, handledTerminal]
  )

  // Shared header: close (with cancel-confirm) + a secure-payment trust cue.
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <TouchableOpacity
        style={styles.headerButton}
        onPress={handleRequestClose}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={t('common.close')}
      >
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || t('screens.payment.headerTitle')}
        </Text>
        <View style={styles.secureRow}>
          <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
          <Text style={styles.secureText} numberOfLines={1}>
            {hostLabel || t('screens.payment.secure')}
          </Text>
        </View>
      </View>
      {/* Spacer to keep the title centered opposite the close button. */}
      <View style={styles.headerButton} />
    </View>
  )

  // Content-shaped loading state: a checkout/payment-form skeleton instead of a
  // bare centered spinner. Offset below the header so the summary card is visible.
  const brandedLoading = (
    <View style={[styles.loadingOverlay, { paddingTop: insets.top + 64 }]}>
      <PaymentSkeleton />
    </View>
  )

  // Branded, full-screen failure state. Rendered as an overlay above the still-
  // mounted WebView (below the header) so "Try again" can reload the same URL.
  const brandedFailure = failure ? (
    <View style={styles.failureOverlay}>
      <View style={styles.failureContent}>
        <View style={styles.failureIconRing}>
          <Ionicons name="close-circle" size={56} color={colors.error} />
        </View>
        <Text style={styles.failureTitle}>{t('screens.payment.failedTitle')}</Text>
        <Text style={styles.failureBody}>
          {failure.reason || t('screens.payment.failedBody')}
        </Text>
        <TouchableOpacity
          style={styles.failurePrimaryButton}
          onPress={handleTryAgain}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('screens.payment.tryAgain')}
        >
          <Text style={styles.failurePrimaryButtonText}>{t('screens.payment.tryAgain')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.failureGhostButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('screens.payment.backToEvent')}
        >
          <Text style={styles.failureGhostButtonText}>{t('screens.payment.backToEvent')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null

  if (!url) {
    return <View style={styles.center} />
  }

  if (needsAuthHeader && !resolvedAuthToken) {
    return (
      <View style={styles.container}>
        {header}
        {brandedLoading}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {header}
      <WebView
        ref={webViewRef}
        source={{
          uri: url,
          headers:
            resolvedAuthToken && isTrustedHost
              ? { Authorization: `Bearer ${resolvedAuthToken}` }
              : undefined,
        }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(state) => onNavChange(state.url)}
        onMessage={(event) => {
          try {
            // Only our own pages may report a purchase result. The checkout
            // passes through MonCash / card pages that can run script, and any
            // of them could otherwise post {status:'success'} and end the flow.
            if (!isTrustedPaymentUrl(event?.nativeEvent?.url)) return
            const raw = event?.nativeEvent?.data
            if (!raw) return
            const parsed = JSON.parse(String(raw))
            if (parsed?.source !== 'tikem') return
            if (parsed?.type === 'page_ready') {
              // First paint is possible: show the page instead of the skeleton.
              setLoading(false)
              return
            }
            if (parsed?.type !== 'purchase_result') return

            if (parsed?.status === 'success') {
              finishWithSuccess()
              return
            }
            if (parsed?.status === 'failed') {
              const reason = typeof parsed?.reason === 'string' ? parsed.reason : ''
              finishWithFailure(failureReasonMessage(reason))
            }
          } catch {
            // ignore
          }
        }}
        // No startInLoadingState: it stacks the library's own white spinner over
        // the page until onLoadEnd (full `load`), hiding it even after our
        // skeleton lifts at DOMContentLoaded. Our skeleton is the loading state.
        javaScriptEnabled
        domStorageEnabled
        // Keep the checkout form steady when the number/PIN fields are focused:
        // stop iOS from auto-shifting the WebView's content insets as the
        // keyboard shows/hides (the main cause of the page "jumping around").
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        // Pin the viewport as early as possible (before-load), then again after
        // load in case the page rewrote its own <head>. Both runs are idempotent.
        injectedJavaScriptBeforeContentLoaded={PAGE_FIT_JS + '\n' + PAGE_READY_JS}
        injectedJavaScript={PAGE_FIT_JS}
      />

      {loading && !failure ? brandedLoading : null}
      {brandedFailure}
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  secureText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  failureOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  failureContent: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  failureIconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.error,
    marginBottom: 24,
  },
  failureTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  failureBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  failurePrimaryButton: {
    width: '100%',
    height: 56,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    marginBottom: 12,
  },
  failurePrimaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  failureGhostButton: {
    width: '100%',
    height: 44,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failureGhostButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
})
