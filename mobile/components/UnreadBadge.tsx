/**
 * The small red unread badge (tester 2026-11-25: "a little red one when you
 * have an unread message"). Inline next to a row title, or `floating` on the
 * corner of an icon (Home header chat icon). Nothing renders at zero.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors as T } from '../theme/tokens';
import { unreadBadgeLabel } from '../lib/unreadBadge';

export default function UnreadBadge({
  count,
  floating,
  style,
}: {
  count: number;
  /** Pinned to the top-right corner of its (relative) parent, ringed in the canvas colour. */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const label = unreadBadgeLabel(count);
  if (!label) return null;
  return (
    <View
      style={[styles.badge, floating && styles.floating, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.text} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: T.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 8.5,
    borderWidth: 1.5,
    borderColor: T.bg,
  },
  text: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', lineHeight: 13, fontVariant: ['tabular-nums'] },
});
