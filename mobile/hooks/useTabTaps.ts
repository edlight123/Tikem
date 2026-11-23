import { useEffect, useRef, type RefObject } from 'react';
import { useNavigation, useScrollToTop } from '@react-navigation/native';

/** Two taps on the active tab within this window count as a double tap. */
const DOUBLE_TAP_MS = 400;

/**
 * The tab you're already on: one tap scrolls back to the top, two quick taps
 * also refresh. Profile keeps its own rule (double tap switches attendee /
 * organizer, AppNavigator) and Home / Discover keep their own tabPress
 * handlers. Port of Tikra 451bbb65.
 *
 * Call it before any early return, with the ref attached to the screen's main
 * ScrollView / FlatList.
 */
export function useTabTaps(scrollRef: RefObject<any>, onRefresh?: () => void) {
  useScrollToTop(scrollRef);
  const navigation = useNavigation<any>();
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const last = useRef(0);
  useEffect(() => {
    const unsub = navigation.addListener?.('tabPress', () => {
      // A tap that switches TO this tab is not a tap on the active tab.
      if (!navigation.isFocused?.()) {
        last.current = 0;
        return;
      }
      const now = Date.now();
      if (now - last.current < DOUBLE_TAP_MS) {
        last.current = 0;
        refresh.current?.();
        return;
      }
      last.current = now;
    });
    return unsub;
  }, [navigation]);
}
