/**
 * StretchyHero: a full-bleed hero at the top of an Animated.ScrollView that
 * stretches up into the pull-down instead of revealing a bare band of page
 * colour above it (iOS bounce).
 *
 * The hero's picture (photo, veil) goes in `background`; whatever is laid out
 * inside the hero box goes in `children` and scrolls normally.
 *
 * Pass the same `scrollY` the ScrollView's native-driver `onScroll` writes
 * to. Android has no negative offset, so there it is simply the hero.
 */
import React from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export function stretchTransform(scrollY: Animated.Value, height: number) {
  const h = Math.max(1, height);
  // At offset -d the content sits d lower: scale by (h + d) / h about the
  // centre and lift by d / 2, so the top stays on the screen's top edge and
  // the bottom stays where the page continues.
  return [
    { translateY: scrollY.interpolate({ inputRange: [-h, 0], outputRange: [-h / 2, 0], extrapolateRight: 'clamp' }) },
    { scale: scrollY.interpolate({ inputRange: [-h, 0], outputRange: [2, 1], extrapolateRight: 'clamp' }) },
  ];
}

export default function StretchyHero({
  scrollY,
  height,
  background,
  children,
  backgroundColor,
  style,
}: {
  scrollY: Animated.Value;
  height: number;
  /** Stretches with the pull. */
  background: React.ReactNode;
  children?: React.ReactNode;
  /** Behind the background (and while a photo loads). */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height }, style]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: stretchTransform(scrollY, height) }]}>
        <View style={[StyleSheet.absoluteFill, styles.clip, backgroundColor ? { backgroundColor } : null]}>{background}</View>
      </Animated.View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
