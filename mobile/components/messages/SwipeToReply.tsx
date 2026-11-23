import React, { useMemo, useRef } from 'react';
import { Animated, Dimensions, Platform, StyleSheet, type StyleProp, type View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CornerUpLeft } from 'lucide-react-native';
import { colors as T, radius } from '../../theme/tokens';
import { tapLight } from '../../lib/haptics';
import { useReducedMotion } from './types';

/** Drag this far right and let go to reply. */
const THRESHOLD = 56;
/** The bubble stops following the finger here (rubber band past it). */
const MAX_PULL = 84;
/** Touches that start this close to the left edge belong to the system back swipe. */
const EDGE_GUARD = Platform.OS === 'ios' ? 24 : 8;
/** Rightward travel before the swipe activates. */
const ACTIVE_DX = 10;
/** Vertical travel that hands the touch to the list's scrolling instead. */
const FAIL_DY = 12;
/** Hold this long (ms) without moving to open the actions menu. */
const LONG_PRESS_MS = 300;
/** A press that drifts further than this (pt) is a drag, not a press or tap. */
const PRESS_SLOP = 8;
/** Second tap within this window (ms) is a double tap. */
const DOUBLE_TAP_MS = 280;
const FAR = 10_000;

/** Window rectangle of the bubble (measureInWindow). */
export type BubbleWindowRect = { x: number; y: number; width: number; height: number };

/**
 * Every gesture on a message bubble, in ONE gesture-handler detector:
 *  - swipe right to reply: a reply arrow slides in, pops at the threshold, and
 *    letting go past it calls `onReply`; the bubble always springs back;
 *  - hold 300ms without moving to open the actions menu (`onLongPress`, with
 *    the bubble's window rectangle so the menu can lift it out where it sits);
 *  - double tap for the quick heart (`onDoubleTap`);
 *  - single tap (`onTap`, with the touch's y inside the bubble, to jump to a
 *    quoted message).
 *
 * They race: whichever activates first cancels the rest. The pan activates
 * after 10pt of rightward travel while the long press and taps fail once the
 * finger drifts 8pt, so a drag is always the swipe and never the menu (Tikra
 * shipped the long press on a separate Pressable and a drag opened the menu).
 * The pan fails on 12pt of vertical travel or any leftward travel, so the
 * list's scrolling and the back swipe are untouched.
 *
 * Callbacks run on the JS thread (`runOnJS(true)`) and the bubble moves with
 * React Native's Animated, like the rest of the app: no Reanimated worklets.
 * Needs a GestureHandlerRootView above it; MessageThreadScreen provides one
 * around itself only (an app-wide root blocked taps in Tikra's 1.0.3).
 */
export default function SwipeToReply({
  children,
  enabled,
  onReply,
  onLongPress,
  onDoubleTap,
  onTap,
  style,
}: {
  children: React.ReactNode;
  /** All gestures on (off for a message still sending). */
  enabled: boolean;
  /** Swipe-to-reply; omit to turn only the swipe off (a closed or blocked thread). */
  onReply?: () => void;
  onLongPress?: (rect: BubbleWindowRect | null) => void;
  /** Omit to turn double tap off (no reactions in a blocked thread). */
  onDoubleTap?: () => void;
  /** `y`: where the tap landed, measured from the bubble's top. */
  onTap?: (y: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const pulled = useRef(new Animated.Value(0)).current;
  const crossed = useRef(false);
  const viewRef = useRef<View>(null);
  // Latest callbacks, so the gesture objects are not rebuilt every render.
  const latest = useRef({ onReply, onLongPress, onDoubleTap, onTap });
  latest.current = { onReply, onLongPress, onDoubleTap, onTap };
  const canSwipe = !!onReply;
  const canDouble = !!onDoubleTap;

  const gesture = useMemo(() => {
    const width = Dimensions.get('window').width;
    const springBack = () => {
      crossed.current = false;
      if (reduceMotion) {
        pulled.setValue(0);
        return;
      }
      Animated.spring(pulled, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 6 }).start();
    };

    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(enabled && canSwipe)
      .activeOffsetX([-FAR, ACTIVE_DX])
      .failOffsetX([-ACTIVE_DX, FAR])
      .failOffsetY([-FAIL_DY, FAIL_DY])
      .onTouchesDown((e, manager) => {
        const x0 = e.allTouches[0]?.absoluteX ?? width / 2;
        if (x0 <= EDGE_GUARD) manager.fail();
      })
      .onUpdate((e) => {
        const dx = Math.max(0, e.translationX);
        pulled.setValue(dx <= MAX_PULL ? dx : MAX_PULL + (dx - MAX_PULL) * 0.25);
        if (!crossed.current && dx >= THRESHOLD) {
          crossed.current = true;
          tapLight();
        } else if (crossed.current && dx < THRESHOLD) {
          crossed.current = false;
        }
      })
      .onEnd((e) => {
        if (e.translationX >= THRESHOLD) latest.current.onReply?.();
      })
      .onFinalize(springBack);

    const longPress = Gesture.LongPress()
      .runOnJS(true)
      .enabled(enabled)
      .minDuration(LONG_PRESS_MS)
      .maxDistance(PRESS_SLOP)
      .onStart(() => {
        const cb = latest.current.onLongPress;
        if (!cb) return;
        const node = viewRef.current as unknown as {
          measureInWindow?: (fn: (x: number, y: number, w: number, h: number) => void) => void;
        } | null;
        if (node && typeof node.measureInWindow === 'function') {
          node.measureInWindow((x, y, w, h) => cb(w > 0 && h > 0 ? { x, y, width: w, height: h } : null));
        } else {
          cb(null);
        }
      });

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .enabled(enabled && canDouble)
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_MS)
      .maxDistance(PRESS_SLOP)
      .onEnd((_e, success) => {
        if (success) latest.current.onDoubleTap?.();
      });

    const singleTap = Gesture.Tap()
      .runOnJS(true)
      .enabled(enabled)
      .maxDistance(PRESS_SLOP)
      .onEnd((e, success) => {
        if (success) latest.current.onTap?.(e.y);
      });

    // The double tap gets first claim on taps; the single tap waits for it to fail.
    return Gesture.Race(pan, longPress, Gesture.Exclusive(doubleTap, singleTap));
  }, [enabled, canSwipe, canDouble, reduceMotion, pulled]);

  const arrowOpacity = pulled.interpolate({ inputRange: [0, 16, THRESHOLD], outputRange: [0, 0.35, 1], extrapolate: 'clamp' });
  const arrowScale = pulled.interpolate({
    inputRange: [0, THRESHOLD, THRESHOLD + 10],
    outputRange: [0.6, 1, 1.12],
    extrapolate: 'clamp',
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={viewRef as any} collapsable={false} style={[style, { transform: [{ translateX: pulled }] }]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.arrow, { opacity: arrowOpacity, transform: [{ scale: arrowScale }] }]}
        >
          <CornerUpLeft size={15} color={T.textPrimary} strokeWidth={1.75} />
        </Animated.View>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // A quiet square fill beside the bubble, line icon on top.
  arrow: {
    position: 'absolute',
    left: -40,
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.neutralMuted,
  },
});
