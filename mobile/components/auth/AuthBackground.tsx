import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors as T } from '../../theme/tokens';

/**
 * The auth (login / sign-up) backdrop: the black canvas, nothing else.
 *
 * It used to show a rotating photograph under a scrim, but cropped to a full
 * phone the people sat behind the form (one read as just a hand), and Tikra's
 * owner rejected the same photo backdrop on device ("the heck is that").
 * Premium here means quiet: the wordmark and the form on solid ground
 * (ported from Tikra 2026-11-24).
 */
export function AuthBackground({ children }: { children?: React.ReactNode }) {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
});

export default AuthBackground;
