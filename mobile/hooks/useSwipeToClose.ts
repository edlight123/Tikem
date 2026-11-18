import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

/**
 * Swipe a bottom sheet down to close it, like a native sheet (owner,
 * 2026-11-18: "for a lot of these when i slide down it doesn't work").
 *
 *   const swipe = useSwipeToClose(onClose, visible);
 *   <Animated.View style={[styles.sheet, swipe.sheetStyle]}>
 *     <View {...swipe.panHandlers}>{handle + title row}</View>
 *     <ScrollView>…</ScrollView>
 *   </Animated.View>
 *
 * Put `panHandlers` on the grab handle + header only, never on a ScrollView:
 * the list keeps its own scrolling. A drag past `threshold` points, or a quick
 * flick, closes; anything less springs back.
 */
export function useSwipeToClose(onClose: () => void, visible = true, threshold = 90) {
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Each opening starts in place, even after a swipe-close.
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim on touch-start. Many sheets sit inside a Pressable (a backdrop
        // that closes on tap, or an inner one that swallows taps); once that
        // ancestor holds the responder, a child is never asked on move, so a
        // move-only claim would never fire. Buttons inside the header still
        // win: start negotiation bubbles from the deepest view up.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > threshold || g.vy > 1.2) {
            Animated.timing(translateY, { toValue: 900, duration: 180, useNativeDriver: true }).start(() =>
              closeRef.current()
            );
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
      }),
    [threshold, translateY]
  );

  return { panHandlers: responder.panHandlers, sheetStyle: { transform: [{ translateY }] } };
}
