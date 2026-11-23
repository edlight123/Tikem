import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Calls `poll` every `intervalMs` while the screen is focused and the app is in
 * the foreground. It never fires on focus itself (screens already load on
 * focus); it only keeps an open list fresh. Backgrounding the app pauses it and
 * coming back runs one catch-up poll, then the timer resumes.
 */
export function useFocusPoll(poll: () => void, intervalMs: number) {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (timer) return;
        timer = setInterval(() => pollRef.current(), intervalMs);
      };
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
      if (AppState.currentState === 'active') start();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          pollRef.current();
          start();
        } else {
          stop();
        }
      });
      return () => {
        stop();
        sub.remove();
      };
    }, [intervalMs]),
  );
}
