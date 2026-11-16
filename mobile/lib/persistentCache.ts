import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A small on-device copy of a screen's last good data, so a cold start (an
 * app opened from a notification) shows it instantly while the fresh load
 * runs. Keys MUST include the signed-in uid (and the org / event) so one
 * account never sees another's copy; screens delete the entry when a load is
 * refused (fail closed). Entries older than MAX_AGE_MS are ignored.
 */

const PREFIX = 'tikem:pcache:';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_BYTES = 400_000;

export async function readPersisted<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return null;
    return value as T;
  } catch {
    return null;
  }
}

export async function writePersisted(key: string, value: unknown): Promise<void> {
  try {
    const raw = JSON.stringify({ at: Date.now(), value });
    if (raw.length > MAX_BYTES) return;
    await AsyncStorage.setItem(PREFIX + key, raw);
  } catch {
    // Best effort only.
  }
}

export async function deletePersisted(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    // Best effort only.
  }
}

/** Every persisted copy (sign-out wipes them). */
export async function clearPersisted(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Best effort only.
  }
}
