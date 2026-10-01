// UTM tracking links for an event page. Same URL shape as the web builder
// (lib/attribution.ts buildTrackingUrl), always on the www host: the apex 308s
// to www, which drops the query on some clients.
//
// Links live on the server now (tracking_links, via
// /api/organizer/events/{id}/tracking-links — see lib/api/trackingLinks.ts) so
// they can carry click and sale counters. Builds before that kept them in
// AsyncStorage; parseStoredLinks + trackingStorageKey remain only to migrate
// those device-local links up the first time the screen loads.

export const EVENT_SHARE_ORIGIN = 'https://www.tikem.co';

/** A link as the server returns it, counters included. */
export interface TrackingLink {
  id: string;
  label: string;
  source: string;
  medium: string;
  campaign: string;
  url: string;
  createdAt: string | null;
  clicks: number;
  salesCount: number;
  ticketsCount: number;
  /** Minor units (cents) per ISO currency — never summed across currencies. */
  revenueByCurrency: Record<string, number>;
}

/** The pre-server, device-only shape (AsyncStorage). Migration input only. */
export interface LocalTrackingLink {
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

/**
 * Mirrors the web's buildTrackingUrl: only non-empty params, in
 * source/medium/campaign order, then the `t=` id when there is one.
 */
export function buildTrackingUrl(
  base: string,
  source: string,
  medium: string,
  campaign: string,
  id?: string | null
): string {
  const parts: string[] = [];
  const add = (key: string, value: string) => {
    const v = value.trim();
    if (v) parts.push(`${key}=${encodeURIComponent(v).replace(/%20/g, '+')}`);
  };
  add('utm_source', source);
  add('utm_medium', medium);
  add('utm_campaign', campaign);
  if (id) add('t', id);
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

export function trackingStorageKey(eventId: string): string {
  return `tikem.trackingLinks.${eventId}`;
}

/** Parse what AsyncStorage holds, dropping anything malformed. */
export function parseStoredLinks(raw: string | null): LocalTrackingLink[] {
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

/** Each currency on its own line item, joined — e.g. "G 1,500 · $40". */
export function revenueEntries(byCurrency: Record<string, number> | null | undefined): [string, number][] {
  return Object.entries(byCurrency || {})
    .filter(([cur, cents]) => /^[A-Z]{3}$/.test(cur) && Number(cents) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, cents]) => [cur, Number(cents)]);
}
