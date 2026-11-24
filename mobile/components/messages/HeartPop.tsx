import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { isReducedMotion } from '../../lib/a11y';

/**
 * The heart that pops over a bubble when it is double-tapped: springs up,
 * settles, then floats off and fades. Remount it (new `key`) to play it again.
 * Reduce Motion: it appears at full size, holds, and fades in place.
 */
export default function HeartPop({ emoji, onDone }: { emoji: string; onDone?: () => void }) {
  const scale = useRef(new Animated.Value(0.2)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    let alive = true;
    // The phone's Reduce Motion or the in-app "always" (lib/a11y).
    Promise.resolve(isReducedMotion())
      .then((reduced) => {
        if (!alive) return;
        if (reduced) scale.setValue(1);
        anim = reduced
          ? Animated.sequence([
              Animated.delay(450),
              Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
            ])
          : Animated.sequence([
              Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 12 }),
              Animated.delay(200),
              Animated.parallel([
                Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
                Animated.timing(lift, { toValue: -16, duration: 240, useNativeDriver: true }),
              ]),
            ]);
        anim.start(({ finished }) => finished && onDone?.());
      });
    return () => {
      alive = false;
      anim?.stop();
    };
    // Plays once per mount (remount with a new key to replay).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity, transform: [{ translateY: lift }, { scale }] }]}>
      <Text style={styles.emoji}>{emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 32, lineHeight: 40 },
});
