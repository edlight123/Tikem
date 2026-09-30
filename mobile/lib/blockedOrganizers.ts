/**
 * The signed-in user's blocked organizers (App Store guideline 1.2).
 *
 * One app-wide store, so blocking on an organizer's profile removes their
 * events from Home / Discover / Search / category pages and hides their
 * notifications at once (optimistic) — every screen reads the same Set via
 * `useBlockedOrganizers()` and re-filters when it changes.
 *
 * Source of truth: users/{uid}/blocked_organizers/{organizerId}, written only
 * by the server (POST/DELETE /api/users/me/blocks/[organizerId], which also
 * drops the follow). The owner may READ the subcollection (firestore.rules), so
 * we listen to it live; if that read is refused (rules not deployed yet) we fall
 * back to GET /api/users/me/blocks.
 */
import { useSyncExternalStore } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { backendJson } from './api/backend';

let blocked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let started = false;
let unsubscribeSnapshot: (() => void) | null = null;

function emit(next: ReadonlySet<string>) {
  blocked = next;
  listeners.forEach((l) => l());
}

async function loadViaApi() {
  try {
    const res = await backendJson<{ organizerIds?: string[] }>('/api/users/me/blocks');
    emit(new Set((res?.organizerIds || []).map(String)));
  } catch (err) {
    console.warn('[blockedOrganizers] API fallback failed', err);
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  onAuthStateChanged(auth, (user) => {
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;
    emit(new Set());
    if (!user) return;
    unsubscribeSnapshot = onSnapshot(
      collection(db, 'users', user.uid, 'blocked_organizers'),
      (snap) => emit(new Set(snap.docs.map((d) => d.id))),
      (err) => {
        console.warn('[blockedOrganizers] live read refused; using the API', err?.message);
        void loadViaApi();
      }
    );
  });
}

function subscribe(listener: () => void) {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current blocked set; re-renders the caller whenever it changes. */
export function useBlockedOrganizers(): ReadonlySet<string> {
  ensureStarted();
  return useSyncExternalStore(subscribe, () => blocked, () => blocked);
}

export function isOrganizerBlocked(organizerId: string | null | undefined): boolean {
  return !!organizerId && blocked.has(String(organizerId));
}

/**
 * Block or unblock. Applied optimistically, rolled back (and rethrown) if the
 * server refuses, so the caller can show an error.
 */
export async function setOrganizerBlocked(organizerId: string, block: boolean): Promise<void> {
  const previous = blocked;
  const next = new Set(previous);
  if (block) next.add(organizerId);
  else next.delete(organizerId);
  emit(next);
  try {
    await backendJson(`/api/users/me/blocks/${encodeURIComponent(organizerId)}`, {
      method: block ? 'POST' : 'DELETE',
    });
  } catch (err) {
    emit(previous);
    throw err;
  }
}

/** Drop events whose organizer is blocked. Pure. */
export function filterBlockedEvents<T extends { organizer_id?: string | null }>(
  events: T[],
  blockedSet: ReadonlySet<string>
): T[] {
  if (!blockedSet || blockedSet.size === 0) return events;
  return events.filter((e) => !(e?.organizer_id && blockedSet.has(String(e.organizer_id))));
}
