/**
 * The app side of national days (lib/nationalDays.ts holds the calendar).
 *
 * - The remote control doc `config/national_days` is read once per 10 minutes
 *   at most, in the background. Until it lands (or when it is missing,
 *   unreadable or offline) the built-in calendar decides, so nothing ever
 *   waits on it. The last good copy is kept in AsyncStorage for the next
 *   cold start.
 * - `useNationalDay()` re-renders its screen when the config arrives.
 * - `themedArt(fallback)` swaps the big empty states and the login backdrop
 *   to the day's art while a day is active.
 * - Dev preview: EXPO_PUBLIC_FORCE_NATIONAL_DAY=vertieres forces a day on in a
 *   __DEV__ build. Release builds ignore it.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { artByKey, type ArtPiece } from './artLibrary';
import {
  activeNationalDay,
  nationalDayArtKey,
  type ActiveNationalDay,
  type NationalDay,
  type NationalDayConfig,
} from './nationalDays';

const CACHE_MS = 10 * 60 * 1000;
const STORAGE_KEY = 'nationalDays.config.v1';
const DISMISS_PREFIX = 'nationalDays.dismissed.';

let config: NationalDayConfig | null = null;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

const forcedKey = (): string | null => {
  if (!__DEV__) return null;
  const v = process.env.EXPO_PUBLIC_FORCE_NATIONAL_DAY;
  return v && /^[a-z]{2,24}$/.test(v) ? v : null;
};

async function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw && !fetchedAt) {
      config = JSON.parse(raw);
      notify();
    }
  } catch {
    // A bad cache is no cache.
  }
}

/** Refresh the remote config in the background. Never throws. */
export function refreshNationalDayConfig(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < CACHE_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    await hydrateFromStorage();
    try {
      const snap = await getDoc(doc(db, 'config', 'national_days'));
      config = snap.exists() ? ((snap.data() as NationalDayConfig) ?? null) : null;
      fetchedAt = Date.now();
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config ?? null)).catch(() => {});
      notify();
    } catch (err) {
      // Offline, rules not deployed yet… the built-in calendar stands. Retry
      // after the cache window rather than on every render.
      fetchedAt = Date.now();
      if (__DEV__) console.warn('[nationalDays] config read failed', err);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The active day right now, from whatever config is in hand. Synchronous. */
export function currentNationalDay(now: Date = new Date()): ActiveNationalDay | null {
  return activeNationalDay(now, config, { force: forcedKey() });
}

/** The art piece for a day: its own, else its fallback (always in the library). */
export function nationalDayArt(day: NationalDay): ArtPiece | undefined {
  return artByKey(nationalDayArtKey(day, (k) => !!artByKey(k)));
}

/**
 * The day's art while a day is active, else `fallback`. For the big empty
 * states and the login backdrop.
 */
export function themedArt<T extends ArtPiece | undefined>(fallback: T): ArtPiece | T {
  const active = currentNationalDay();
  return (active && nationalDayArt(active.day)) || fallback;
}

/** Subscribe a screen to the active day; kicks off a background refresh. */
export function useNationalDay(): ActiveNationalDay | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    refreshNationalDayConfig();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return currentNationalDay();
}

/**
 * Dismissal is per occurrence AND phase: closing the "in 3 days" banner keeps
 * it closed through the lead days, and the banner comes back once on the day
 * itself. Closing it on the day keeps it closed for that day.
 */
const dismissKey = (a: ActiveNationalDay) => `${DISMISS_PREFIX}${a.day.key}.${a.start}.${a.phase}`;

export async function isNationalDayDismissed(a: ActiveNationalDay): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(dismissKey(a))) === '1';
  } catch {
    return false;
  }
}

export async function dismissNationalDay(a: ActiveNationalDay): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissKey(a), '1');
  } catch {
    // Not remembered; it shows again next launch. Harmless.
  }
}
