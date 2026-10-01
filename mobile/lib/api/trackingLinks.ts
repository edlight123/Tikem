// Server CRUD for an event's tracking links (organizer-owned; counters are
// server-written only) plus the one-time migration of device-local links.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendJson } from './backend';
import {
  LocalTrackingLink,
  TrackingLink,
  parseStoredLinks,
  trackingStorageKey,
} from '../trackingLinks';

const base = (eventId: string) => `/api/organizer/events/${encodeURIComponent(eventId)}/tracking-links`;

export async function listTrackingLinks(eventId: string): Promise<TrackingLink[]> {
  const data = await backendJson<{ links: TrackingLink[] }>(base(eventId));
  return Array.isArray(data?.links) ? data.links : [];
}

export async function createTrackingLink(
  eventId: string,
  input: { label: string; source: string; medium: string; campaign: string; importKey?: string; createdAt?: number }
): Promise<TrackingLink> {
  const data = await backendJson<{ link: TrackingLink }>(base(eventId), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.link;
}

export async function deleteTrackingLink(eventId: string, linkId: string): Promise<void> {
  await backendJson(`${base(eventId)}/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
}

/**
 * Upload links an older build kept on this phone, once. Each carries its local
 * id as `importKey`, so a retry after a dropped connection never duplicates a
 * link. Uploaded links leave local storage one by one; whatever failed stays
 * for the next visit. Never throws.
 */
export async function migrateLocalTrackingLinks(eventId: string): Promise<number> {
  const key = trackingStorageKey(eventId);
  let local: LocalTrackingLink[] = [];
  try {
    local = parseStoredLinks(await AsyncStorage.getItem(key));
  } catch {
    return 0;
  }
  if (local.length === 0) return 0;

  const remaining: LocalTrackingLink[] = [];
  let migrated = 0;
  // Oldest first, so the server's newest-first order matches what the phone showed.
  for (const link of [...local].reverse()) {
    try {
      await createTrackingLink(eventId, {
        label: link.label,
        source: link.source,
        medium: link.medium,
        campaign: link.campaign,
        importKey: link.id,
        createdAt: link.createdAt,
      });
      migrated += 1;
    } catch {
      remaining.unshift(link);
    }
  }
  try {
    if (remaining.length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(remaining));
  } catch {
    // Next visit retries; importKey keeps it idempotent.
  }
  return migrated;
}
