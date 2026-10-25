/**
 * Device sound/autoplay settings, on by default, switchable on the profile
 * (owner requests 2026-10-25): "Play event songs" and "Play trailers
 * automatically". Kept in AsyncStorage, read through one small store per
 * setting so the event page and the profile toggle agree.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

function createDevicePref(key: string) {
  let enabled = true;
  let loaded = false;
  // False until the stored choice is read, so someone who turned it off never
  // gets a first second of autoplay before the setting arrives.
  let settled = false;
  const listeners = new Set<() => void>();

  const emit = (next: boolean) => {
    enabled = next;
    listeners.forEach((l) => l());
  };

  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    AsyncStorage.getItem(key)
      .then((v) => {
        settled = true;
        emit(v !== '0');
      })
      .catch(() => {
        settled = true;
        emit(enabled);
      });
  };

  const subscribe = (listener: () => void) => {
    ensureLoaded();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    /** The setting, for the profile toggle (shows the default while loading). */
    useValue(): boolean {
      ensureLoaded();
      return useSyncExternalStore(subscribe, () => enabled, () => enabled);
    },
    /** True only once the stored choice is known and it is on. */
    useAllowed(): boolean {
      ensureLoaded();
      return useSyncExternalStore(subscribe, () => settled && enabled, () => false);
    },
    set(next: boolean): void {
      settled = true;
      emit(next);
      AsyncStorage.setItem(key, next ? '1' : '0').catch(() => {});
    },
  };
}

const song = createDevicePref('tikem.songAutoplay');
const trailer = createDevicePref('tikem.trailerAutoplay');

export const useSongAutoplay = song.useValue;
export const useSongAutoplayAllowed = song.useAllowed;
export const setSongAutoplay = song.set;

export const useTrailerAutoplay = trailer.useValue;
export const useTrailerAutoplayAllowed = trailer.useAllowed;
export const setTrailerAutoplay = trailer.set;
