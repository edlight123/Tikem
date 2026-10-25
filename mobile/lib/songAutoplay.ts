/**
 * "Play event songs automatically": on by default, switchable on the profile
 * (owner request 2026-10-25). A device setting kept in AsyncStorage, read
 * through one small store so the event page and the profile toggle agree.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tikem.songAutoplay';

let enabled = true;
let loaded = false;
// False until the stored choice is read, so someone who turned it off never
// hears a first second of music before the setting arrives.
let settled = false;
const listeners = new Set<() => void>();

function emit(next: boolean) {
  enabled = next;
  listeners.forEach((l) => l());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((v) => {
      settled = true;
      emit(v !== '0');
    })
    .catch(() => {
      settled = true;
      emit(enabled);
    });
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The setting, for the profile toggle (shows the default while loading). */
export function useSongAutoplay(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, () => enabled, () => enabled);
}

/** True only once the stored choice is known and it is on: what the player waits for. */
export function useSongAutoplayAllowed(): boolean {
  ensureLoaded();
  return useSyncExternalStore(subscribe, () => settled && enabled, () => false);
}

export function setSongAutoplay(next: boolean): void {
  settled = true;
  emit(next);
  AsyncStorage.setItem(KEY, next ? '1' : '0').catch(() => {});
}
