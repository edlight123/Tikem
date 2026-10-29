import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, withAlpha } from '../../theme/tokens';

/**
 * The empty poster frame on Create event: a slowly turning mirror ball the
 * poster goes "into" (TestFlight: "make it look almost like a disco ball
 * you're uploading to … the words are too heavy, more subtle").
 *
 * The ball is a circle-clipped strip of mirror tiles twice its width that
 * scrolls one ball-width per turn, so the loop is seamless. Two gradients
 * shade it into a sphere. A few light specks twinkle around it. Everything
 * runs on the native driver; with Reduce Motion on, it stands still.
 */

const COLS = 9; // tiles across the ball; the strip repeats every COLS columns
const TURN_MS = 16000;

// Deterministic tile tones (no Math.random, so the ball looks the same on
// every render): mostly dark mirror, a few bright facets, two teal glints.
function tileTone(row: number, col: number): string {
  const n = (row * 37 + col * 61 + row * col * 7) % 23;
  if (n === 3 && row % 4 === 1) return withAlpha(colors.teal, 0.55);
  if (n === 0 || n === 11) return '#8A8A8A';
  if (n % 5 === 0) return '#4A4A4A';
  if (n % 3 === 0) return '#333333';
  return '#242424';
}

// Specks of reflected light on the frame, as fractions of its size.
const SPECKS = [
  { x: 0.14, y: 0.16, s: 3 },
  { x: 0.82, y: 0.12, s: 2 },
  { x: 0.9, y: 0.42, s: 3 },
  { x: 0.08, y: 0.5, s: 2 },
  { x: 0.24, y: 0.72, s: 2 },
  { x: 0.76, y: 0.68, s: 3 },
];

interface Props {
  label: string;
  linkLabel: string;
  onUpload: () => void;
  onBrowse: () => void;
  style?: ViewStyle | ViewStyle[];
}

export default function MirrorBallDropzone({ label, linkLabel, onUpload, onBrowse, style }: Props) {
  const [width, setWidth] = useState(0);
  const [still, setStill] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);

  useEffect(() => {
    if (still) return;
    const spin = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: TURN_MS, easing: Easing.linear, useNativeDriver: true })
    );
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    spin.start();
    glow.start();
    return () => {
      spin.stop();
      glow.stop();
    };
  }, [still, turn, twinkle]);

  const ball = Math.round(width * 0.44);
  const tile = ball / COLS;

  const strip = useMemo(() => {
    if (!ball) return null;
    const rows = [];
    for (let r = 0; r < COLS; r++) {
      const cells = [];
      for (let c = 0; c < COLS * 2; c++) {
        cells.push(
          <View
            key={c}
            style={{ width: tile - 1, height: tile - 1, margin: 0.5, backgroundColor: tileTone(r, c % COLS) }}
          />
        );
      }
      rows.push(
        <View key={r} style={styles.row}>
          {cells}
        </View>
      );
    }
    return rows;
  }, [ball, tile]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const translateX = turn.interpolate({ inputRange: [0, 1], outputRange: [0, -ball] });

  return (
    <Pressable
      onPress={onUpload}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.frame, style, pressed && styles.pressed]}
    >
      {width > 0 &&
        SPECKS.map((p, i) => (
          <Animated.View
            key={i}
            style={[
              styles.speck,
              {
                left: p.x * width,
                top: p.y * width * 1.25,
                width: p.s,
                height: p.s,
                borderRadius: p.s / 2,
                opacity: twinkle.interpolate({
                  inputRange: [0, 1],
                  outputRange: i % 2 ? [0.15, 0.7] : [0.7, 0.15],
                }),
              },
            ]}
          />
        ))}

      {ball > 0 && (
        <View style={styles.center}>
          <View style={{ width: ball, height: ball, borderRadius: ball / 2, overflow: 'hidden' }}>
            <Animated.View style={{ width: ball * 2, transform: [{ translateX }] }}>{strip}</Animated.View>
            {/* Sphere shading: dark edges left/right, lit from the top. */}
            <LinearGradient
              colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']}
              locations={[0, 0.3, 0.7, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.10)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                styles.highlight,
                { top: ball * 0.16, left: ball * 0.24, width: ball * 0.14, height: ball * 0.14, borderRadius: ball },
              ]}
            />
          </View>

          <View style={styles.caption}>
            <Ionicons name="arrow-up" size={14} color={colors.textSecondary} />
            <Text style={styles.label}>{label}</Text>
          </View>
        </View>
      )}

      <Pressable
        onPress={onBrowse}
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.linkText}>{linkLabel}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  speck: {
    position: 'absolute',
    backgroundColor: colors.white,
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 28,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.1,
    color: colors.textPrimary,
  },
  link: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
  },
  linkText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});
