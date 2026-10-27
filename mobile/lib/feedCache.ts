// Offline-first cache for the public events feed, shared by Home and Discover
// (they pull the same country-scoped published events). TestFlight feedback:
// "not showing any events because of internet issues… can it be more
// transparent". Firestore answers OFFLINE from an empty local cache WITHOUT
// throwing, so a browsing surface can't tell "offline" from "no events". We
// persist the last good feed per market and restore it when offline, and the
// screens show an honest "offline / retry" state only when there is nothing to
// restore. One key per country, so warming it on Home warms it for Discover.
//
// Dates are stored as ISO strings (JSON-safe) and revived to Date on read.
import AsyncStorage from '@react-native-async-storage/async-storage';

const feedCacheKey = (country: string) => `feed_cache_${(country || '').toUpperCase()}`;

const serializeFeed = (events: any[]) =>
  (events || []).map((e) => ({
    ...e,
    start_datetime: e.start_datetime ? new Date(e.start_datetime).toISOString() : null,
    end_datetime: e.end_datetime ? new Date(e.end_datetime).toISOString() : null,
  }));

const reviveFeed = (events: any[]) =>
  (events || []).map((e) => ({
    ...e,
    start_datetime: e.start_datetime ? new Date(e.start_datetime) : null,
    end_datetime: e.end_datetime ? new Date(e.end_datetime) : null,
  }));

export async function persistFeedCache(country: string, events: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(feedCacheKey(country), JSON.stringify(serializeFeed(events)));
  } catch {}
}

export async function restoreFeedCache(country: string): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(feedCacheKey(country));
    return raw ? reviveFeed(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
