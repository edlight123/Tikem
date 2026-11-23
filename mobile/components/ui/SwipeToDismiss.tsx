/**
 * Swipe a row left or right past the threshold to dismiss it; a shorter drag
 * springs back. Core RN PanResponder + Animated (the app has no app-wide
 * GestureHandlerRootView, on purpose). Only a clearly horizontal drag is
 * claimed, so vertical scrolling stays untouched.
 *
 * Swiping is not reachable by a screen reader: give the row an accessibility
 * action that calls the same dismiss.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Dimensions, PanResponder } from 'react-native';

const THRESHOLD = 90;

export default function SwipeToDismiss({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const done = useRef(onDismiss);
  done.current = onDismiss;
  const reduced = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduced.current = !!v;
      })
      .catch(() => {});
  }, []);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        const width = Dimensions.get('window').width;
        if (Math.abs(g.dx) > THRESHOLD || Math.abs(g.vx) > 0.8) {
          Animated.timing(x, { toValue: g.dx > 0 ? width : -width, duration: 180, useNativeDriver: false }).start(() =>
            done.current(),
          );
        } else if (reduced.current) {
          x.setValue(0);
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const width = Dimensions.get('window').width;
  const opacity = x.interpolate({ inputRange: [-width, 0, width], outputRange: [0, 1, 0] });
  return (
    <Animated.View style={{ transform: [{ translateX: x }], opacity }} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}
