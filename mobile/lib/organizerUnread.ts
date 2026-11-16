import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { backendJson } from './api/backend';

/**
 * Unread attendee messages for the acting org: one shared count behind the
 * dot on the organizer Dashboard tab and the number on the dashboard's
 * Messages row. Refreshed when the organizer tabs mount, when the app comes
 * back to the foreground, and whenever a screen calls refreshOrganizerUnread()
 * (dashboard focus, leaving the inbox). A failed fetch keeps the last value.
 */

let count = 0;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((l) => l());
}

export function refreshOrganizerUnread(): Promise<void> {
  if (!inflight) {
    inflight = backendJson<{ unreadCount?: number }>('/api/organizer/messages?limit=100')
      .then((r) => set(Number(r?.unreadCount) || 0))
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Forget the count (sign-out, org switch to one the user can't read). */
export function clearOrganizerUnread() {
  set(0);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The current count. With `poll`, this component also owns the refresh
 * triggers (mount + foreground); mount it once, in the organizer tabs.
 * `enabled` false (door staff) keeps it at 0 and never asks the server.
 */
export function useOrganizerUnread(opts: { enabled: boolean; poll?: boolean; orgKey?: string | null }): number {
  const { enabled, poll, orgKey } = opts;
  const value = useSyncExternalStore(subscribe, () => count);

  useEffect(() => {
    if (!poll) return;
    if (!enabled) {
      clearOrganizerUnread();
      return;
    }
    refreshOrganizerUnread();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshOrganizerUnread();
    });
    return () => sub.remove();
  }, [enabled, poll, orgKey]);

  return enabled ? value : 0;
}
