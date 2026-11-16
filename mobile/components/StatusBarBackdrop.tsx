import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { withAlpha } from '../theme/tokens';

/**
 * A solid canvas strip the height of the top safe-area inset, with a short
 * fade beneath it, for screens that scroll with no top bar (organizer
 * dashboard, profile). Without it, content slid up under the clock and
 * battery. Render it as the LAST child of the screen's root view so it sits
 * above the scroller; it never takes touches.
 */
export default function StatusBarBackdrop({ fade = 14 }: { fade?: number }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (insets.top <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { height: insets.top + fade }]}>
      <View style={{ height: insets.top, backgroundColor: colors.background }} />
      <LinearGradient
        colors={[colors.background, withAlpha(colors.background, 0)]}
        style={{ height: fade }}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
