/**
 * Connect an outside account (Eventbrite) from the app. Only the account
 * sign-in is web: the flow starts on our own www host with the Firebase
 * Bearer token and the acting-org header (so the server sees the same org
 * the app is acting for), goes to Eventbrite, and comes back to our
 * callback, then to /organizer/import?eventbrite=…, where this screen closes
 * and hands the result back to the import screen.
 *
 * Same pattern as StripeConnectWebViewScreen: custom headers ride only on
 * the first document request, so every main-frame navigation to one of OUR
 * hosts (exact list, lib/integrationWeb) is re-issued with them. Eventbrite's
 * pages never receive the token.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { X } from 'lucide-react-native';
import { auth } from '../config/firebase';
import { API_BASE_URL } from '../lib/api/backend';
import { ORG_HEADER, actingOrgHeader } from '../lib/activeOrgState';
import { eventbriteReturn, isTokenHost } from '../lib/integrationWeb';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { Touchable } from '../components/ui/Touchable';

type Params = { url: string; title?: string; returnTo?: string };

export default function IntegrationWebViewScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { url, title, returnTo = 'ImportEvents' } = (route.params || {}) as Params;
  const topInset = Platform.OS === 'ios' ? 0 : insets.top;

  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [authedUrl, setAuthedUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const finished = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tok = await auth.currentUser?.getIdToken().catch(() => null);
      if (!alive) return;
      setToken(tok || null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(
    (result: string) => {
      if (finished.current) return;
      finished.current = true;
      navigation.navigate({ name: returnTo, params: { eventbriteResult: result, at: Date.now() }, merge: true });
    },
    [navigation, returnTo]
  );

  const headersFor = useCallback(
    (target: string): Record<string, string> | undefined => {
      if (!token || !isTokenHost(target, API_BASE_URL)) return undefined;
      const h: Record<string, string> = { Authorization: `Bearer ${token}` };
      const org = actingOrgHeader();
      if (org && org !== auth.currentUser?.uid) h[ORG_HEADER] = org;
      return h;
    },
    [token]
  );

  const onShouldStart = useCallback(
    (req: { url: string; isTopFrame?: boolean }) => {
      const next = req?.url || '';
      const done = eventbriteReturn(next, API_BASE_URL);
      if (done) {
        finish(done);
        return false;
      }
      if (req.isTopFrame === false) return true;
      if (!token || !isTokenHost(next, API_BASE_URL)) return true;
      if (next === authedUrl) return true;
      // Our host again (the callback): reload it WITH the headers.
      setAuthedUrl(next);
      return false;
    },
    [authedUrl, finish, token]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <Touchable
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <X size={22} color={colors.text} />
        </Touchable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || ''}
        </Text>
        <View style={styles.headerButton} />
      </View>
      {ready && url ? (
        <WebView
          source={{ uri: authedUrl, headers: headersFor(authedUrl) }}
          onShouldStartLoadWithRequest={onShouldStart}
          onNavigationStateChange={(s) => {
            const done = eventbriteReturn(s.url, API_BASE_URL);
            if (done) finish(done);
          }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => finish('error')}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
        />
      ) : null}
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      zIndex: 2,
      backgroundColor: colors.background,
      paddingHorizontal: 8,
      paddingBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.text },
    loading: { position: 'absolute', top: 120, left: 0, right: 0, alignItems: 'center' },
  });
