/**
 * Mobile API client for the social layer.
 * Reuses the same web backend endpoints via `backendFetch` (Firebase-auth'd),
 * so the data model stays identical across web, PWA, and native.
 */

import { backendFetch } from './backend';
import type {
  ContactMatch,
  EventSocialAttendance,
  FriendSuggestion,
  FriendsGoingResponse,
  FriendshipState,
  PublicUserSummary,
  SocialLinks,
  PrivacySettings,
} from '../../types/social';

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export interface ConnectionsOverview {
  friends: PublicUserSummary[];
  incoming: PublicUserSummary[];
  outgoing: PublicUserSummary[];
}

/** Friends + pending requests for the current user. */
export async function fetchConnections(): Promise<ConnectionsOverview> {
  const res = await backendFetch('/api/connections', { method: 'GET' });
  const data = await readJson(res);
  if (!res.ok || !data) {
    return { friends: [], incoming: [], outgoing: [] };
  }
  return {
    friends: data.friends || [],
    incoming: data.incoming || [],
    outgoing: data.outgoing || [],
  };
}

export async function sendConnectionRequest(targetUserId: string): Promise<FriendshipState> {
  const res = await backendFetch('/api/connections/request', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || 'Failed to send request');
  return (data?.status as FriendshipState) || 'request_sent';
}

export async function respondToConnectionRequest(
  targetUserId: string,
  action: 'accept' | 'decline'
): Promise<FriendshipState> {
  const res = await backendFetch('/api/connections/respond', {
    method: 'POST',
    body: JSON.stringify({ targetUserId, action }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error || 'Failed to respond');
  return (data?.status as FriendshipState) || 'none';
}

export async function removeConnection(targetUserId: string): Promise<void> {
  const res = await backendFetch('/api/connections/remove', {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(data?.error || 'Failed to remove connection');
  }
}

export interface UserSearchResult extends PublicUserSummary {
  friendship: FriendshipState;
}

export async function searchUsers(q: string): Promise<UserSearchResult[]> {
  if (!q || q.trim().length < 2) return [];
  const res = await backendFetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`, {
    method: 'GET',
  });
  const data = await readJson(res);
  return res.ok && data?.results ? data.results : [];
}

/** The server reads at most this many numbers per call. */
const MATCH_CONTACTS_CHUNK = 200;

export async function matchContacts(phones: string[]): Promise<ContactMatch[]> {
  const unique = Array.from(new Set(phones));
  if (!unique.length) return [];
  const byUid = new Map<string, ContactMatch>();
  for (let i = 0; i < unique.length; i += MATCH_CONTACTS_CHUNK) {
    const res = await backendFetch('/api/connections/match-contacts', {
      method: 'POST',
      body: JSON.stringify({ phones: unique.slice(i, i + MATCH_CONTACTS_CHUNK) }),
    });
    const data = await readJson(res);
    // A 429 (daily budget) keeps what was matched so far.
    if (!res.ok || !data?.matches) break;
    for (const m of data.matches as ContactMatch[]) byUid.set(m.uid, m);
  }
  return Array.from(byUid.values());
}

/** "Who's going" attendance for an event (privacy-enforced server-side). */
export async function fetchEventSocial(eventId: string): Promise<EventSocialAttendance> {
  const res = await backendFetch(`/api/events/${eventId}/social`, { method: 'GET' });
  const data = await readJson(res);
  if (!res.ok || !data) {
    return { totalGoing: 0, viewerIsGoing: false, friendsGoing: [], publicGoing: [] };
  }
  return data;
}

export interface SocialProfileUpdate {
  bio?: string;
  socialLinks?: SocialLinks;
  privacy?: Partial<PrivacySettings>;
  /** users/{uid}.discoverable: friend suggestions + "friends going". */
  discoverable?: boolean;
}

/** Update social/bio/privacy via the shared profile endpoint (sanitized server-side). */
export async function updateSocialProfile(updates: SocialProfileUpdate): Promise<void> {
  const res = await backendFetch('/api/profile/update', {
    method: 'POST',
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(data?.error || 'Failed to update profile');
  }
}

/**
 * Batch "friends going" counts for a set of events (viewer's perspective).
 * Returns a map of eventId -> distinct friend count. Empty for logged-out users.
 */
export async function fetchFriendsGoingCounts(
  eventIds: string[]
): Promise<Record<string, number>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    const res = await backendFetch('/api/events/social-counts', {
      method: 'POST',
      body: JSON.stringify({ eventIds: ids }),
    });
    const data = await readJson(res);
    return res.ok && data?.counts ? data.counts : {};
  } catch {
    return {};
  }
}

/**
 * "People you may know" (config/auth.friend_suggestions, enforced server-side).
 * Empty on any failure, when the flag is off, or when rate-limited.
 */
export async function fetchFriendSuggestions(): Promise<FriendSuggestion[]> {
  try {
    const res = await backendFetch('/api/connections/suggestions', { method: 'GET' });
    const data = await readJson(res);
    return res.ok && data?.enabled === true && Array.isArray(data?.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

/** The viewer's own connections going to an event. Never anyone else. */
export async function fetchFriendsGoing(eventId: string): Promise<FriendsGoingResponse> {
  const off: FriendsGoingResponse = { enabled: false, count: 0, friends: [] };
  if (!eventId) return off;
  try {
    const res = await backendFetch(`/api/events/${encodeURIComponent(eventId)}/friends-going`, { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok || !data || data.enabled !== true) return off;
    return {
      enabled: true,
      count: Number(data.count) || 0,
      friends: Array.isArray(data.friends) ? data.friends : [],
    };
  } catch {
    return off;
  }
}
