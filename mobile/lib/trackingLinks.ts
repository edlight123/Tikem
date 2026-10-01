// UTM tracking links for an event page. Same URL shape as the web builder
// (app/organizer/events/[id]/tracking/TrackingLinksClient.tsx), but always on
// the www host: the apex 308s to www, which drops the query on some clients.

export const EVENT_SHARE_ORIGIN = 'https://www.tikem.co';

export interface TrackingLink {
  id: string;
  label: string;
  source: string;
  medium: string;
  campaign: string;
  url: string;
  createdAt: number;
}

export function eventPageUrl(eventId: string): string {
  return `${EVENT_SHARE_ORIGIN}/events/${encodeURIComponent(eventId)}`;
}

/** Mirrors the web's buildUrl: only non-empty params, in source/medium/campaign order. */
export function buildTrackingUrl(base: string, source: string, medium: string, campaign: string): string {
  const parts: string[] = [];
  const add = (key: string, value: string) => {
    const v = value.trim();
    if (v) parts.push(`${key}=${encodeURIComponent(v).replace(/%20/g, '+')}`);
  };
  add('utm_source', source);
  add('utm_medium', medium);
  add('utm_campaign', campaign);
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

export function trackingStorageKey(eventId: string): string {
  return `tikem.trackingLinks.${eventId}`;
}

/** Parse what AsyncStorage holds, dropping anything malformed. */
export function parseStoredLinks(raw: string | null): TrackingLink[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (l: any) => l && typeof l.id === 'string' && typeof l.url === 'string' && typeof l.label === 'string'
    );
  } catch {
    return [];
  }
}
