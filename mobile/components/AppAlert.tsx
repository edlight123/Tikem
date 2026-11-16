import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { radius, spacing } from '../theme/tokens';

/**
 * In-app replacement for `Alert.alert`.
 *
 * The OS alert is the one surface the app cannot style: it ignores the black
 * canvas, uses the system typeface, and renders light-mode chrome in the middle
 * of a dark, poster-forward product. There were 213 of them.
 *
 * The signature deliberately MIRRORS `Alert.alert(title, message?, buttons?)`
 * so a call site migrates by swapping the callee — no restructuring, which is
 * what makes a 200-site change safe to do without running every flow.
 */
export interface AppAlertButton {
  text: string;
  onPress?: () => void;
  /** 'destructive' paints the label red; 'cancel' is muted. Same vocabulary as Alert. */
  style?: 'default' | 'cancel' | 'destructive';
}

type ShowAlert = (title: string, message?: string, buttons?: AppAlertButton[]) => void;

const AppAlertContext = createContext<ShowAlert | null>(null);

/**
 * Returns a `showAlert` with Alert.alert's signature. Falls back to a no-op
 * warning rather than throwing if the provider is missing, so a screen rendered
 * outside the tree (tests, storybook) degrades instead of crashing.
 */
export function useAppAlert(): ShowAlert {
  const ctx = useContext(AppAlertContext);
  return (
    ctx ||
    ((title: string, message?: string) => {
      console.warn('[AppAlert] no provider mounted; dropped alert:', title, message);
    })
  );
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [state, setState] = useState<AlertState | null>(null);

  const showAlert = useCallback<ShowAlert>((title, message, buttons) => {
    setState({
      title,
      message,
      // Alert.alert with no buttons shows a lone dismiss; match that.
      buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    });
  }, []);

  const dismiss = useCallback(
    (button?: AppAlertButton) => {
      setState(null);
      // Fire AFTER dismissal so a handler that navigates or opens another sheet
      // is not racing this modal's teardown — stacked RN modals drop on iOS.
      if (button?.onPress) setTimeout(button.onPress, 0);
    },
    []
  );

  const value = useMemo(() => showAlert, [showAlert]);

  return (
    <AppAlertContext.Provider value={value}>
      {children}
      <Modal
        visible={state !== null}
        transparent
        animationType="fade"
        onRequestClose={() => dismiss(state?.buttons.find((b) => b.style === 'cancel'))}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{state?.title}</Text>
            {!!state?.message && <Text style={styles.message}>{state.message}</Text>}
            <View style={styles.buttons}>
              {(state?.buttons || []).map((b, i) => (
                <TouchableOpacity
                  key={`${b.text}-${i}`}
                  // Only the affirmative action gets the filled white pill.
                  // Cancel AND destructive are outlined — a red label on a
                  // white fill reads as a warning badge, and the app reserves
                  // filled surfaces for the one action it wants you to take.
                  style={[
                    styles.button,
                    b.style === 'cancel' || b.style === 'destructive'
                      ? styles.buttonCancel
                      : styles.buttonDefault,
                  ]}
                  onPress={() => dismiss(b)}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.buttonText,
                      b.style === 'destructive' && styles.buttonTextDestructive,
                      b.style === 'cancel' && styles.buttonTextCancel,
                    ]}
                  >
                    {b.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AppAlertContext.Provider>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    message: {
      marginTop: spacing.sm,
      fontSize: 15,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    buttons: {
      marginTop: spacing.xl,
      gap: spacing.sm,
    },
    button: {
      height: 48,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDefault: {
      backgroundColor: colors.text,
    },
    buttonCancel: {
      backgroundColor: colors.surfaceRaised,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.background,
    },
    buttonTextDestructive: {
      color: colors.error,
    },
    buttonTextCancel: {
      color: colors.text,
    },
  });
