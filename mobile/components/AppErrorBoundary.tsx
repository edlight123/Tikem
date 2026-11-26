import React from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { logError } from '../lib/errorLog';
import { hideSplash } from '../lib/splash';

/**
 * The app's last line of defence against a blank screen.
 *
 * In React Native 0.81 a render error that nothing catches unmounts the whole
 * tree and is only reported as a soft (non-fatal) error, so the app does not
 * crash: it shows the bare root view, painted app.json's `backgroundColor`
 * (#0E4A3A), with the Android navigation bar on top. That is the "solid green
 * screen until I close the app" testers saw. This boundary shows a readable
 * screen with a Reload button instead, and records the error (lib/errorLog).
 */

type Props = { children: React.ReactNode };
type State = { error: unknown; resetKey: number };

/** The device language when it is one Tikèm speaks (the app's own setting may be unreadable here). */
function deviceLanguage(): 'en' | 'fr' | 'ht' {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const code = require('expo-localization').getLocales?.()?.[0]?.languageCode;
    return code === 'fr' || code === 'ht' ? code : 'en';
  } catch {
    return 'en';
  }
}

/** Reload the JS (foreground only, user-initiated); false when not possible. */
export async function reloadApp(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require('expo-updates');
    if (Updates?.isEnabled && Updates.reloadAsync && AppState.currentState === 'active') {
      await Updates.reloadAsync();
      return true;
    }
  } catch {}
  return false;
}

export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown error') };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    hideSplash();
    void logError(error, { source: 'render', componentStack: info?.componentStack ?? null });
  }

  private retry = async () => {
    if (await reloadApp()) return;
    // Dev / Expo Go / reload unavailable: remount the tree from scratch.
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (!error) return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;

    const lang = deviceLanguage();
    const fr = lang === 'fr';
    const ht = lang === 'ht';
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return (
      <View style={styles.root} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.title}>
            {ht ? 'Gen yon pwoblèm' : fr ? 'Un problème est survenu' : 'Something went wrong'}
          </Text>
          <Text style={styles.body}>
            {ht
              ? 'Tikèm jwenn yon erè. Rechaje pou kontinye.'
              : fr
                ? 'Tikèm a rencontré une erreur. Rechargez pour continuer.'
                : 'Tikèm hit an error. Reload to carry on.'}
          </Text>
          <Pressable
            onPress={this.retry}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{ht ? 'Rechaje' : fr ? 'Recharger' : 'Reload'}</Text>
          </Pressable>
          <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent}>
            <Text style={styles.detailsText} selectable>
              {message.slice(0, 400)}
            </Text>
          </ScrollView>
        </View>
      </View>
    );
  }
}

// Fixed colours: this screen sits outside the theme provider (it must render
// even when the providers crashed). Tikèm's dark canvas, 4px corners.
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#141414',
    borderRadius: 4,
    padding: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.72)', marginBottom: 16 },
  button: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#000000', fontSize: 15, fontWeight: '600' },
  details: { maxHeight: 120, marginTop: 16 },
  detailsContent: { paddingBottom: 4 },
  detailsText: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
});
