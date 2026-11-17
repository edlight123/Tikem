import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { backendJson } from './api/backend';

/**
 * Organizer replies the attendee hasn't opened yet: one shared count behind
 * the dot on the attendee Profile tab and the number on Profile > Messages.
 *
 * Push and email deliver a reply when it happens; this dot is the "you missed
 * it" fallback, so it refreshes on mount, on every return to the foreground,
 * and whenever a screen calls refreshAttendeeUnread() (opening a thread,
 * leaving Messages). A failed fetch keeps the last value.
 */

let count = 0;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((l) => l());
}

export function refreshAttendeeUnread(): Promise<void> {
  if (!inflight) {
    inflight = backendJson<{ unreadCount?: number }>('/api/messages')
      .then((r) => set(Number(r?.unreadCount) || 0))
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Forget the count (sign-out). */
export function clearAttendeeUnread() {
  set(0);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The current count. With `poll`, this component owns the refresh triggers
 * (mount + foreground); mount it once, in the attendee tabs. `enabled` false
 * (signed out) keeps it at 0 and never asks the server.
 */
export function useAttendeeUnread(opts: { enabled: boolean; poll?: boolean; userKey?: string | null }): number {
  const { enabled, poll, userKey } = opts;
  const value = useSyncExternalStore(subscribe, () => count);

  useEffect(() => {
    if (!poll) return;
    if (!enabled) {
      clearAttendeeUnread();
      return;
    }
    refreshAttendeeUnread();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshAttendeeUnread();
    });
    return () => sub.remove();
  }, [enabled, poll, userKey]);

  return enabled ? value : 0;
}
