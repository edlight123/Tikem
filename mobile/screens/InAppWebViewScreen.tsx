import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { useTheme } from '../contexts/ThemeContext';
import { nativeOrganizerRoute } from '../lib/organizerWebRoutes';

type Params = {
  url: string
}

/** Tikèm's own website hosts: their pages load in embed mode and may route to native screens. */
function ownPath(url: string): { path: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    if (u.hostname !== 'tikem.co' && u.hostname !== 'www.tikem.co') return null
    return { path: u.pathname }
  } catch {
    return null
  }
}

/** Our pages carry ?embed=1 (lib/embed-mode on the web): the site hides its own bars. */
export function withEmbed(url: string): string {
  if (!ownPath(url)) return url
  try {
    const u = new URL(url)
    u.searchParams.set('embed', '1')
    return u.toString()
  } catch {
    return url
  }
}

export default function InAppWebViewScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<any>()
  const navigation = useNavigation<any>()
  const { url } = (route.params || {}) as Params

  const webViewRef = useRef<WebView>(null)
  const [loading, setLoading] = useState(true)

  // An organizer page the app has its own screen for opens that screen
  // instead (lib/organizerWebRoutes), never the website's version of it.
  const initialNative = useMemo(() => {
    const own = url ? ownPath(url) : null
    return own ? nativeOrganizerRoute(own.path) : null
  }, [url])
  useEffect(() => {
    if (initialNative) navigation.replace(initialNative.screen, initialNative.params)
  }, [initialNative, navigation])

  const source = useMemo(() => ({ uri: withEmbed(url) }), [url])

  const onLoadEnd = useCallback(() => {
    setLoading(false)
  }, [])

  const onShouldStart = useCallback(
    (req: WebViewNavigation) => {
      const own = ownPath(req.url)
      const native = own ? nativeOrganizerRoute(own.path) : null
      if (native) {
        navigation.navigate(native.screen, native.params)
        return false
      }
      return true
    },
    [navigation]
  )

  if (!url || initialNative) {
    return <View style={styles.center} />
  }

  return (
    <View style={styles.container}>
      {/* "TikemApp" tells the website it is inside the app (lib/embed-mode), so it hides its own bars. */}
      <WebView
        ref={webViewRef}
        source={source}
        onLoadEnd={onLoadEnd}
        onShouldStartLoadWithRequest={onShouldStart}
        applicationNameForUserAgent="TikemApp"
      />
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : null}
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
  loadingOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
})
