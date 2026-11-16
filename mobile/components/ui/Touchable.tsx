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
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { tapLight } from '../../lib/haptics';

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

export const Touchable = forwardRef<View, TouchableProps>(function Touchable(
  { children, style, scale = 0.97, haptic = true, pressedColor, onPressIn, onPressOut, disabled, hitSlop, ...rest },
  ref
) {
  const value = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const animate = scale !== false && !disabled;

  const springTo = (to: number) =>
    Animated.spring(value, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();

  return (
    <Pressable
      ref={ref}
      {...rest}
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
        style={[style, pressed && pressedColor ? { backgroundColor: pressedColor } : null, animate ? { transform: [{ scale: value }] } : null]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
});

export default Touchable;
