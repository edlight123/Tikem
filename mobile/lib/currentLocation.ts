/**
 * "Use my current location", the device half: is the native module in this
 * binary, permission, one coarse position, and the area it resolves to
 * (lib/areaResolve.ts does the resolving, on the device).
 *
 * NATIVE MODULE GUARD: expo-location arrived with store build 1.0.3+. An OTA
 * on an older binary has the JS but not the native side, and requiring
 * expo-location there throws at load. So nothing imports it statically: we
 * look the native module up first (requireOptionalNativeModule never throws)
 * and every caller hides the feature when `locationSupported()` says no.
 *
 * Rules:
 *   - The permission prompt only appears because someone tapped "Use my
 *     current location" (`ask: true`). Never on launch; "follow my location"
 *     refreshes and event-page distances pass `ask: false`.
 *   - Low accuracy only (Android declares coarse location only).
 *
 * PRIVACY: coordinates never leave the phone and are never written to storage
 * or the profile. The last position is kept in MEMORY for this session only,
 * for the "2.4 km away" label on event pages.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { nearestArea, type LatLng, type ResolvedArea } from './areaResolve';

type ExpoLocation = typeof import('expo-location');

let cachedModule: ExpoLocation | null | undefined;

/**
 * The expo-location JS module, ONLY when its native side is in this binary.
 * `lookup` is injectable for the unit test.
 */
export function loadLocationModule(
  lookup: (name: string) => unknown = requireOptionalNativeModule,
  load: () => ExpoLocation = () => require('expo-location') as ExpoLocation,
): ExpoLocation | null {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = null;
  try {
    if (!lookup('ExpoLocation')) return cachedModule;
    cachedModule = load();
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** Test hook: forget the cached lookup. */
export function resetLocationModuleForTest() {
  cachedModule = undefined;
  sessionPosition = null;
}

/** Does this build have location at all? Decides whether the feature is shown. */
export function locationSupported(): boolean {
  return !!loadLocationModule();
}

export type LocationErrorCode = 'denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  code: LocationErrorCode;
  constructor(code: LocationErrorCode) {
    super(`location_${code}`);
    this.code = code;
  }
}

const POSITION_TIMEOUT_MS = 8000;

// In memory only: dies with the app process, never persisted.
let sessionPosition: LatLng | null = null;

/** The position found this session (after a tap or a follow refresh), or null. */
export function getSessionPosition(): LatLng | null {
  return sessionPosition;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new LocationError('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function readPosition(Location: ExpoLocation): Promise<LatLng> {
  let pos: Awaited<ReturnType<ExpoLocation['getCurrentPositionAsync']>> | null = null;
  try {
    pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      POSITION_TIMEOUT_MS,
    );
  } catch (e) {
    // Indoors or a slow fix: a recent last-known position is plenty for a metro.
    pos = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 }).catch(() => null);
    if (!pos) throw e instanceof LocationError ? e : new LocationError('unavailable');
  }
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  sessionPosition = p;
  return p;
}

/** Ask (or only check) permission, read one coarse position, resolve the area. Throws LocationError. */
export async function detectCurrentArea({ ask = true }: { ask?: boolean } = {}): Promise<ResolvedArea> {
  const Location = loadLocationModule();
  if (!Location) throw new LocationError('unavailable');
  let granted = false;
  try {
    const perm = ask
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    granted = perm.status === 'granted';
  } catch {
    throw new LocationError('unavailable');
  }
  if (!granted) throw new LocationError('denied');
  const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!servicesOn) throw new LocationError('unavailable');

  const area = nearestArea(await readPosition(Location));
  if (!area) throw new LocationError('unavailable');
  return area;
}

/**
 * The position for a distance label, never prompting: this session's position,
 * else (only when permission is already granted) one quiet coarse read.
 */
export async function positionIfGranted(): Promise<LatLng | null> {
  if (sessionPosition) return sessionPosition;
  const Location = loadLocationModule();
  if (!Location) return null;
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    return await readPosition(Location);
  } catch {
    return null;
  }
}
