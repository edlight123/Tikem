import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';

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
 * REQUIRED INDEX (deploy `firestore.indexes.json` or this throws at runtime):
 *   events: is_published ASC, country ASC
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
 * Firestore Timestamp | {seconds} | ISO string | Date → Date, or null.
 * The three screens each carried their own copy of this; it lives here now so
 * they cannot drift on what a date is.
 */
const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Published events for ONE country, with `start_datetime`/`end_datetime`
 * already converted to Dates.
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

  const snapshot = await getDocs(
    query(
      collection(db, 'events'),
      where('is_published', '==', true),
      where('country', '==', code),
      limit(max)
    )
  );

  const events = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      start_datetime: toDate(data.start_datetime),
      end_datetime: toDate(data.end_datetime),
    };
  });
  return { events, fromCache: snapshot.metadata.fromCache };
}
