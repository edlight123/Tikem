/**
 * Touchable — the one press primitive (learned from EdLight Code).
 *
 * Every tappable thing should be built on this so the press feel is the same
 * across the app:
 *   - a quick spring scale (0.97 buttons, 0.98 cards; `scale={false}` for rows)
 *   - a light haptic on press-in
 *   - rows get a pressed FILL instead of a bounce (`pressedColor`)
 *   - a 44pt minimum target via hitSlop
 *
 * Uses React Native's Animated (native driver), not Reanimated, to match the
 * rest of the app.
 */
import React, { forwardRef, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { tapLight } from '../../lib/haptics';
import { isReducedMotion } from '../../lib/a11y';

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale target while pressed. Buttons 0.97 (default), cards 0.98, rows `false`. */
  scale?: number | false;
  /** Light haptic on press-in. Default true. */
  haptic?: boolean;
  /** Background while pressed (rows use this instead of a scale). */
  pressedColor?: string;
}

const DEFAULT_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

/**
 * Style keys that place the control in its PARENT (flex share, width, margins,
 * absolute position). They go on the outer Pressable; everything else (fill,
 * padding, radius, inner layout) stays on the animated view.
 *
 * Before this split the whole style landed on the inner view, so `flex: 1`,
 * `width: '100%'` or `alignSelf` never reached the parent's layout: buttons
 * meant to share a row came out content-sized and bunched to one side (owner:
 * "fix the positioning" — Edit Event's footer, the scan and payout tiles).
 */
const OUTER_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'width', 'minWidth', 'maxWidth',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'start', 'end', 'zIndex',
]);

function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle | undefined; inner: ViewStyle | undefined } {
  const flat = StyleSheet.flatten(style) as Record<string, any> | undefined;
  if (!flat) return { outer: undefined, inner: undefined };
  const outer: Record<string, any> = {};
  const inner: Record<string, any> = {};
  for (const [k, v] of Object.entries(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = v;
  // When the outer box is sized by its parent, the inner view fills it.
  const sized = 'flex' in outer || 'flexGrow' in outer || 'width' in outer || outer.alignSelf === 'stretch';
  if (sized && !('flexGrow' in inner)) inner.flexGrow = 1;
  return { outer, inner };
}

export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { children, style, scale = 0.97, haptic = true, pressedColor, onPressIn, onPressOut, disabled, hitSlop, ...rest },
  ref
) {
  const value = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const animate = scale !== false && !disabled;

  // Reduce Motion (lib/a11y): the press fill stays, the scale does not.
  const springTo = (to: number) => {
    if (isReducedMotion()) {
      value.setValue(1);
      return;
    }
    Animated.spring(value, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };

  const { outer, inner } = splitStyle(style);

  return (
    <Pressable
      ref={ref}
      {...rest}
      style={outer}
      disabled={disabled}
      hitSlop={hitSlop ?? DEFAULT_HIT_SLOP}
      onPressIn={(e: GestureResponderEvent) => {
        if (pressedColor) setPressed(true);
        if (haptic && !disabled) tapLight();
        if (animate) springTo(scale as number);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (pressedColor) setPressed(false);
        if (animate) springTo(1);
        onPressOut?.(e);
      }}
    >
      <Animated.View
        style={[inner, pressed && pressedColor ? { backgroundColor: pressedColor } : null, animate ? { transform: [{ scale: value }] } : null]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
});

export default Touchable;
