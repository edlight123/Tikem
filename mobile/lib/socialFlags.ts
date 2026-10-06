/**
 * Remote switches for the social-growth features, from the public
 * `config/auth` doc (same doc as phone sign-in, see lib/phoneAuth.ts):
 *
 *   phone_link_prompt:  the "add your number" sheet after a ticket
 *   friend_suggestions: "people you may know" and "friends going"
 *
 * Fails CLOSED: missing doc, read error or timeout all mean OFF. Cached in
 * memory for 5 minutes; every subscribing screen triggers a re-check after
 * that. The server enforces friend_suggestions on its own too, so this only
 * decides whether to render (and fetch).
 */

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 4000;

export interface SocialFlags {
  phoneLinkPrompt: boolean;
  friendSuggestions: boolean;
}

const OFF: SocialFlags = { phoneLinkPrompt: false, friendSuggestions: false };

let flags: SocialFlags = OFF;
let checkedAt = 0;
let inflight: Promise<SocialFlags> | null = null;
const listeners = new Set<() => void>();

/** Pure: only a literal `true` turns a switch on. */
export function socialFlagsFrom(data: unknown): SocialFlags {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    phoneLinkPrompt: d.phone_link_prompt === true,
    friendSuggestions: d.friend_suggestions === true,
  };
}

export function refreshSocialFlags(force = false): Promise<SocialFlags> {
  if (!force && checkedAt && Date.now() - checkedAt < CACHE_MS) return Promise.resolve(flags);
  if (inflight) return inflight;
  inflight = (async () => {
    let next = OFF;
    try {
      const snap = await Promise.race([
        getDoc(doc(db, 'config', 'auth')),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
      ]);
      next = snap && snap.exists() ? socialFlagsFrom(snap.data()) : OFF;
    } catch {
      next = OFF;
    }
    checkedAt = Date.now();
    const changed = next.phoneLinkPrompt !== flags.phoneLinkPrompt || next.friendSuggestions !== flags.friendSuggestions;
    flags = next;
    if (changed) listeners.forEach((l) => l());
    inflight = null;
    return next;
  })();
  return inflight;
}

/** Current flags (starts OFF) and a re-check on mount. */
export function useSocialFlags(): SocialFlags {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    refreshSocialFlags();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return flags;
}
