/**
 * When must this device (re)send its Expo push token to the server? Pure, so
 * it is unit-tested from the root (__tests__/push-token-cache.test.ts).
 *
 * The cache used to be the bare token string plus a "platform sent" flag, and
 * a match skipped the server call for good. If the server ever dropped the
 * token (pruned after an Expo error, detached when another account registered
 * on this phone, a doc rewrite), this phone stayed silent forever. Tikra's
 * Android testers hit exactly that (cfee2ccc). Now the cache records WHO it
 * was registered for and WHEN, and re-registers when the account changes or
 * the record is older than PUSH_TOKEN_REFRESH_MS. A legacy bare-string value
 * is treated as stale, so every phone re-registers once after the update.
 */
export const PUSH_TOKEN_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface PushTokenCacheRecord {
  token: string;
  uid: string;
  /** ms epoch of the last successful server registration. */
  at: number;
}

export function parsePushTokenCache(raw: string | null | undefined): PushTokenCacheRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.token === 'string' && typeof v.uid === 'string' && typeof v.at === 'number') {
      return { token: v.token, uid: v.uid, at: v.at };
    }
  } catch {
    // A legacy bare token (not JSON): stale.
  }
  return null;
}

export function serializePushTokenCache(rec: PushTokenCacheRecord): string {
  return JSON.stringify(rec);
}

/** The token the cache holds, legacy or not (sign-out still detaches it). */
export function cachedPushToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const rec = parsePushTokenCache(raw);
  if (rec) return rec.token;
  return raw.startsWith('ExponentPushToken[') ? raw : null;
}

export function needsPushRegistration(
  cached: PushTokenCacheRecord | null,
  token: string,
  uid: string | null | undefined,
  now: number,
  refreshMs: number = PUSH_TOKEN_REFRESH_MS
): boolean {
  if (!cached) return true;
  if (cached.token !== token) return true;
  if (!uid || cached.uid !== uid) return true;
  if (!(now - cached.at < refreshMs) || cached.at > now) return true;
  return false;
}
