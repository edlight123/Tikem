import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { isUnlisted } from '../eventVisibility';

/**
 * The ONE published-events fetch behind every public browsing surface
 * (Home, Discover, Search).
 *
 * WHY THIS EXISTS — the bug it fixes
 * ---------------------------------------------------------------------------
 * All three screens used to run `where('is_published','==',true)` with
 * `limit(50)` and NO location predicate, then filter to the user's country and
 * metro ON THE DEVICE. With a small catalogue that is invisible: 50 covers
 * everything. Past ~50 published events those 50 become a LOCATION-BLIND
 * sample — a Miami user could download 50 mostly-Haitian events, filter to
 * Miami, match none, and be told "no events in Miami yet" while Miami events
 * sat unfetched. The failure is silent and reads as weak demand rather than a
 * bug, so the location has to be in the QUERY.
 *
 * Country is the coarse, high-selectivity cut and belongs server-side.
 * Metro/city narrowing stays client-side on purpose: within ONE country the
 * 50-doc sample is no longer dominated by another market, so it is a real
 * sample of the right catalogue.
 *
 * UPCOMING FIRST (the second bug)
 * ---------------------------------------------------------------------------
 * Scoping by country was not enough: `limit(50)` with NO orderBy returns an
 * arbitrary 50 of the country's published events. Haiti carries many seeded
 * showcase events plus every past event, so the upcoming ones could fall out of
 * the 50 and Home/Discover showed few or none. The feed now reads the UPCOMING
 * window (start_datetime >= now - UPCOMING_LOOKBACK_MS) soonest first.
 *
 * `start_datetime` is a Firestore Timestamp on app-made events and an ISO
 * string on web-made ones, and a range/orderBy only matches its own type
 * (Firestore orders every Timestamp before any string). So the window is read
 * ONCE PER TYPE — a Date bound and an ISO-string bound — and the two are
 * merged, de-duped and sorted (mergeUpcomingEvents). Same trick as the
 * reminder cron (lib/notifications/favorite-reminders.ts) and the web
 * discover read (lib/data/events.ts).
 *
 * REQUIRED INDEXES (deploy `firestore.indexes.json`):
 *   events: is_published ASC, country ASC                       (fallback)
 *   events: is_published ASC, country ASC, start_datetime ASC    (upcoming)
 * Until the second is deployed the ordered read fails with
 * `failed-precondition`; the fetch then falls back to the old unordered
 * country query and sorts/filters it on the device, so nothing breaks before
 * the deploy.
 *
 * LEGACY DOCS WITHOUT `country`
 * ---------------------------------------------------------------------------
 * A Firestore equality filter matches only documents that HAVE the field, so an
 * event doc missing `country` is invisible to this query. Readers elsewhere
 * treat a missing country as 'HT' (see `eventCountry` in data/metros.ts), so
 * such a doc used to appear for Haiti. Every current writer stamps the field —
 * mobile `createEvent`/`updateEvent` and the web composer both write
 * `country: <code> || 'HT'` — but the web dev seeder
 * (app/admin/dev/create-test-data) does not, and events created before the
 * field shipped may not either. Those docs need a one-off backfill
 * (`country: 'HT'` wherever the field is absent). We deliberately do NOT add an
 * unfiltered fallback query: silently widening to "everything" is exactly the
 * bug this replaces.
 */

/** How many published events a browsing surface pulls per country. */
export const PUBLISHED_FEED_LIMIT = 50;

/**
 * The upcoming window opens this far back so an event that started earlier
 * but is still running (a multi-day festival) is read. Callers then drop what
 * is over with isEventOver (lib/homeFeeds).
 */
export const UPCOMING_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Firestore Timestamp | {seconds} | ISO string | Date → Date, or null.
 * The three screens each carried their own copy of this; it lives here now so
 * they cannot drift on what a date is.
 */
export const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Published events for ONE country that start on or after
 * now - UPCOMING_LOOKBACK_MS, soonest first, at most `max`, with
 * `start_datetime`/`end_datetime` already converted to Dates. Undated events
 * and events that started before the window are not returned.
 *
 * Callers keep their own downstream rules (rejected, unlisted, over/upcoming,
 * metro, category, search) — this is the fetch, not the policy.
 *
 * Callers MUST hold this until `countryResolved` is true (FiltersContext).
 * Querying with the placeholder country is a known bug: a phone in Haiti set to
 * English (US) reports region "US", which would fetch the wrong market's
 * catalogue and paint it before the profile loads.
 */
export async function fetchPublishedEventsForCountry(
  country: string,
  max: number = PUBLISHED_FEED_LIMIT
): Promise<any[]> {
  return (await fetchPublishedEventsForCountryWithMeta(country, max)).events;
}

/**
 * Same fetch, but it also reports whether Firestore answered from its local
 * cache rather than the server. OFFLINE, `getDocs` does NOT throw — it resolves
 * from the on-device cache, which is usually empty — so an offline phone looks
 * exactly like a market with no events. Browsing surfaces need to tell those
 * two apart to show an honest "you're offline" state instead of "no events".
 */
export async function fetchPublishedEventsForCountryWithMeta(
  country: string,
  max: number = PUBLISHED_FEED_LIMIT
): Promise<{ events: any[]; fromCache: boolean }> {
  const code = (country || '').trim().toUpperCase();
  // Never fall back to an unscoped query — see the note above. A blank country
  // is a caller bug (fetching before the country resolved), so surface it.
  if (!code) {
    throw new Error('fetchPublishedEventsForCountry: a country code is required');
  }

  const since = new Date(Date.now() - UPCOMING_LOOKBACK_MS);
  const upcoming = (bound: Date | string) =>
    getDocs(
      query(
        collection(db, 'events'),
        where('is_published', '==', true),
        where('country', '==', code),
        where('start_datetime', '>=', bound),
        orderBy('start_datetime', 'asc'),
        limit(max)
      )
    );

  try {
    // One read per stored type of start_datetime (see the note above).
    const [asTimestamp, asIsoString] = await Promise.all([
      upcoming(since),
      upcoming(since.toISOString()),
    ]);
    return {
      events: mergeUpcomingEvents([asTimestamp.docs, asIsoString.docs], since, max),
      fromCache: asTimestamp.metadata.fromCache || asIsoString.metadata.fromCache,
    };
  } catch (err) {
    // Only a missing index degrades; any other failure (permissions, network)
    // still surfaces to the caller's error state as before.
    if (!isMissingIndexError(err)) throw err;
    console.warn(
      '[eventFeed] upcoming index (is_published, country, start_datetime) not deployed yet; using the unordered fallback'
    );
  }

  // FALLBACK until the ordered index is deployed: the old unordered country
  // read, filtered to the same window and sorted on the device.
  const snapshot = await getDocs(
    query(
      collection(db, 'events'),
      where('is_published', '==', true),
      where('country', '==', code),
      limit(max)
    )
  );
  return {
    events: mergeUpcomingEvents([snapshot.docs], since, max),
    fromCache: snapshot.metadata.fromCache,
  };
}

/**
 * Published events created in the last `windowMs`, newest first, for Home's
 * "new on Tikèm" rail (lib/newOnTikem picks from them: country, metro,
 * visibility, series). Read on their own so an event announced today for a
 * date weeks out still surfaces; the soonest-first feed above cuts it off.
 *
 * created_at is a Timestamp on app-made events and an ISO string on web-made
 * ones, so it is read once per stored type. Country is applied by the caller,
 * so this uses the deployed index events is_published ASC + created_at DESC.
 * Dates come back as Dates, like the feed. A failed read is an empty rail.
 */
export async function fetchNewOnTikemEvents(
  windowMs: number = 14 * 86_400_000,
  max: number = 80
): Promise<any[]> {
  const since = new Date(Date.now() - windowMs);
  const read = (field: 'published_at' | 'created_at', bound: Date | string) =>
    getDocs(
      query(
        collection(db, 'events'),
        where('is_published', '==', true),
        where(field, '>=', bound),
        orderBy(field, 'desc'),
        limit(max)
      )
    ).catch(() => null);
  const snaps = await Promise.all([
    read('published_at', since.toISOString()),
    read('created_at', since),
    read('created_at', since.toISOString()),
  ]);
  const seen = new Set<string>();
  const out: any[] = [];
  for (const s of snaps) {
    for (const d of s?.docs || []) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() || {};
      out.push({
        id: d.id,
        ...data,
        start_datetime: toDate(data.start_datetime),
        end_datetime: toDate(data.end_datetime),
      });
    }
  }
  return out;
}

/** Firestore's "this query needs a composite index" error. */
export function isMissingIndexError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  const code = String(e.code ?? '');
  if (code === 'failed-precondition' || code === 'firestore/failed-precondition') return true;
  return /requires an index/i.test(String(e.message ?? ''));
}

/** The slice of a Firestore QueryDocumentSnapshot this module reads. */
export interface FeedDocLike {
  id: string;
  data: () => any;
}

/**
 * Merge one or more result lists into the feed: de-duped by id, dates
 * converted, events starting before `since` (or undated) dropped, sorted
 * soonest first and capped at `max`.
 *
 * Each typed read is capped at `max` on its own, so the union of the two holds
 * the overall soonest `max` — slicing after the sort is what keeps a
 * Timestamp-dated and a string-dated event in true start order.
 */
export function mergeUpcomingEvents(
  lists: FeedDocLike[][],
  since: Date,
  max: number = PUBLISHED_FEED_LIMIT
): any[] {
  const sinceMs = since.getTime();
  const seen = new Set<string>();
  const events: any[] = [];
  for (const docs of lists) {
    for (const docSnap of docs) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);
      const data = docSnap.data() || {};
      // Unlisted events are link-only (lib/eventVisibility): never in a public feed.
      if (isUnlisted(data)) continue;
      const start = toDate(data.start_datetime);
      if (!start || start.getTime() < sinceMs) continue;
      events.push({
        id: docSnap.id,
        ...data,
        start_datetime: start,
        end_datetime: toDate(data.end_datetime),
      });
    }
  }
  events.sort((a, b) => a.start_datetime.getTime() - b.start_datetime.getTime());
  return events.slice(0, max);
}
