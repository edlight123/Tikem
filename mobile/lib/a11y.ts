/**
 * Accessibility settings and helpers shared across the app.
 *
 *  - Reduce motion: the phone's setting (AccessibilityInfo) OR the in-app
 *    "Always" choice in Profile > Accessibility. When on, parallax, shimmer,
 *    springs and pops snap to their end state and carousels / trailers stop
 *    playing on their own.
 *  - Bolder text and Higher contrast: in-app switches, saved on this device
 *    (AsyncStorage, never synced: a phone's needs are the phone's). Higher
 *    contrast is applied through `useTheme()` (brighter muted text, stronger
 *    hairlines); bolder text through `ui/Text` and `useBolder()`.
 *  - Larger text: `useCaptionLines()` gives captions an extra line when the
 *    system font size is large, so text wraps instead of being cut off.
 *  - Spoken labels: `joinA11y()` builds one label out of several facts.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ReduceMotionPref = 'system' | 'always';

export interface A11yPrefs {
  reduceMotion: ReduceMotionPref;
  boldText: boolean;
  highContrast: boolean;
}

export const A11Y_PREFS_KEY = 'tikem.a11yPrefs.v1';
export const A11Y_DEFAULTS: A11yPrefs = { reduceMotion: 'system', boldText: false, highContrast: false };

let prefs: A11yPrefs = A11Y_DEFAULTS;
let systemReduceMotion = false;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Reads a stored value defensively: anything unexpected keeps the default. */
export function parseA11yPrefs(raw: string | null | undefined): A11yPrefs {
  if (!raw) return A11Y_DEFAULTS;
  try {
    const p = JSON.parse(raw) as Partial<A11yPrefs> | null;
    if (!p || typeof p !== 'object') return A11Y_DEFAULTS;
    return {
      reduceMotion: p.reduceMotion === 'always' ? 'always' : 'system',
      boldText: p.boldText === true,
      highContrast: p.highContrast === true,
    };
  } catch {
    return A11Y_DEFAULTS;
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(A11Y_PREFS_KEY)
    .then((raw) => {
      prefs = parseA11yPrefs(raw);
      emit();
    })
    .catch(() => {});
  try {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        systemReduceMotion = !!on;
        emit();
      })
      .catch(() => {});
    AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) => {
      systemReduceMotion = !!on;
      emit();
    });
  } catch {
    // Not available (tests): the system setting reads as off.
  }
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current choices, synchronously (outside React). */
export function getA11yPrefs(): A11yPrefs {
  ensureLoaded();
  return prefs;
}

/** The saved in-app accessibility choices, live. */
export function useA11yPrefs(): A11yPrefs {
  return useSyncExternalStore(subscribe, getA11yPrefs, getA11yPrefs);
}

/** Merge and persist a change to the in-app accessibility choices. */
export function setA11yPrefs(patch: Partial<A11yPrefs>): void {
  ensureLoaded();
  prefs = parseA11yPrefs(JSON.stringify({ ...prefs, ...patch }));
  emit();
  AsyncStorage.setItem(A11Y_PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
}

/** Synchronous read for code outside React (an animation callback). */
export function isReducedMotion(): boolean {
  ensureLoaded();
  return prefs.reduceMotion === 'always' || systemReduceMotion;
}

/** True when motion should be cut: the phone's Reduce Motion, or "Always" here. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, isReducedMotion);
}

const readSystem = () => {
  ensureLoaded();
  return systemReduceMotion;
};
/** True when the phone's own Reduce Motion is on (for the Settings hint). */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, readSystem, readSystem);
}

/** True when "Higher contrast" is on. */
export function useHighContrast(): boolean {
  return useA11yPrefs().highContrast;
}

type Weight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | 'normal' | 'bold';
const BUMP: Record<string, Weight> = {
  '100': '300',
  '200': '400',
  '300': '500',
  normal: '600',
  '400': '600',
  '500': '600',
  '600': '700',
  bold: '800',
  '700': '800',
  '800': '900',
  '900': '900',
};

/** One step heavier, for "Bolder text". */
export function bumpWeight(weight: Weight | string | number | undefined): Weight {
  return BUMP[String(weight ?? '400')] ?? '700';
}

/**
 * Maps a font weight to the weight to render: the same normally, one step
 * heavier with "Bolder text" on. `const w = useBolder(); { fontWeight: w('600') }`
 */
export function useBolder(): (weight: Weight) => Weight {
  const { boldText } = useA11yPrefs();
  return boldText ? bumpWeight : (w) => w;
}

/**
 * How many lines a caption may take: `base` normally, one more when the
 * system text size is large (fontScale > 1.3), so a scaled caption wraps
 * instead of being cut with an ellipsis.
 */
export function captionLinesFor(fontScale: number, base = 1): number {
  return fontScale > 1.3 ? base + 1 : base;
}
export function useCaptionLines(base = 1): number {
  const { fontScale } = useWindowDimensions();
  return captionLinesFor(fontScale, base);
}

/** Running text may grow to this multiple of its size with the phone's text size. */
export const BODY_MAX_FONT_SCALE = 1.6;
/** Display sizes and dense UI (tab labels, chips, poster overlays) stop here. */
export const DENSE_MAX_FONT_SCALE = 1.3;

/** Expands a small control's touch area to at least ~44pt. */
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

/** Joins the non-empty parts of a spoken label with commas. */
export function joinA11y(...parts: (string | number | null | undefined | false)[]): string {
  return parts
    .map((p) => (p === null || p === undefined || p === false ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ');
}

/** Test hook: forget loaded state so a test starts clean. */
export function __resetA11yForTests(): void {
  prefs = A11Y_DEFAULTS;
  systemReduceMotion = false;
  loaded = false;
  listeners.clear();
}
