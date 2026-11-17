/**
 * Events the app has already drawn somewhere (a poster card, a rail, a search
 * row), kept in memory so opening one is instant: the event page paints from
 * this copy at once and refreshes from Firestore behind it (owner, 2026-11-17:
 * "when I click on an event it loads too slow").
 *
 * In memory only, per session, capped. A preview is never trusted for money:
 * EventDetailScreen keeps the buy bar hidden until the fresh copy lands.
 */

const MAX = 300;
const cache = new Map<string, any>();

export function primeEventPreview(event: any): void {
  const id = event?.id;
  if (typeof id !== 'string' || !id) return;
  // Re-insert so the most recently seen stay; drop the oldest past the cap.
  cache.delete(id);
  cache.set(id, event);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function primeEventPreviews(events: any[] | null | undefined): void {
  if (!Array.isArray(events)) return;
  for (const e of events) primeEventPreview(e);
}

export function getEventPreview(id: string | undefined | null): any | null {
  return (id && cache.get(id)) || null;
}
