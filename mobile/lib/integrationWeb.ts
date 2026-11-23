/**
 * The one place the app decides where an integration sign-in (Connect
 * Eventbrite) runs and which hosts may see its Firebase token. Pure (no
 * React, Expo or Firebase imports) so root Jest can test it.
 *
 * - The flow runs on www.tikem.co: the apex 308s to www and WebViews drop
 *   custom headers on a redirect, so a URL built on the apex (or on one of
 *   the Vercel aliases the EAS env once pointed at) would arrive signed out.
 * - The token rides only to hosts in an EXACT list: no suffix matching, so
 *   no look-alike subdomain or another site ever receives it. Eventbrite's
 *   own pages never see it.
 */

export const CANONICAL_WEB_ORIGIN = 'https://www.tikem.co';

/** Hosts that are our one deployment. Exact matches only. */
const OWN_HOSTS = new Set(['www.tikem.co', 'tikem.co', 'jointikem.vercel.app', 'eventhaiti.vercel.app']);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Where to open an integration flow, given the app's API base. Our
 * production hosts become www.tikem.co; anything else (a local or preview
 * server set through EXPO_PUBLIC_API_URL) is kept as it is.
 */
export function integrationWebOrigin(apiBase: string): string {
  const host = hostOf(apiBase);
  if (!host || OWN_HOSTS.has(host)) return CANONICAL_WEB_ORIGIN;
  return apiBase.replace(/\/$/, '');
}

/** May this URL receive our Bearer token? Own hosts (exact), plus the configured dev/preview origin. */
export function isTokenHost(url: string, apiBase: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && OWN_HOSTS.has(u.host.toLowerCase())) return true;
  // A local or preview server the app was pointed at: that exact origin only.
  const dev = integrationWebOrigin(apiBase);
  if (dev === CANONICAL_WEB_ORIGIN) return false;
  try {
    return u.origin === new URL(dev).origin;
  } catch {
    return false;
  }
}

export type EventbriteReturn = 'connected' | 'cancelled' | 'error' | 'unavailable';

/** The end of the Connect Eventbrite round trip (/organizer/import?eventbrite=…) on one of our hosts, or null. */
export function eventbriteReturn(url: string, apiBase: string): EventbriteReturn | null {
  if (!isTokenHost(url, apiBase)) return null;
  try {
    const u = new URL(url);
    if (u.pathname.replace(/\/$/, '') !== '/organizer/import') return null;
    const v = u.searchParams.get('eventbrite');
    return v === 'connected' || v === 'cancelled' || v === 'error' || v === 'unavailable' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The ticket link of an event kept in sync from Eventbrite (web
 * lib/import/eventbrite-sync): tickets stay on Eventbrite, so the event page
 * links out instead of selling. Server-written only (firestore.rules); still
 * re-checked here as an https link on a real host.
 */
export function externalTicketsUrl(event: any): string | null {
  const url = event?.external_url;
  if (event?.imported?.source !== 'eventbrite' || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
