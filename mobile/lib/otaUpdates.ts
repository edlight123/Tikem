import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Apply over-the-air updates without making people open the app twice.
 *
 * expo-updates on its own checks at launch, downloads in the background and
 * only runs the new code on the NEXT launch, so a fresh App Store download
 * spends its whole first session on the JS baked into the binary. Here:
 *
 * - Cold start: check while the native splash is still held (lib/splash.ts
 *   waits on `launchUpdateGate`). If a newer update downloads before the
 *   splash's own 4s cap, reload into it behind the splash, so the first screen
 *   people see is already current. On a slow connection the gate opens
 *   anyway and the download carries on.
 * - Back from the background: check again, download quietly, and reload the
 *   next time the app goes to the background, never under someone's thumb.
 *
 * Off in development and in Expo Go (Updates.isEnabled is false there), and
 * after an emergency launch (the runtime fell back to the embedded bundle
 * because an update crashed, so don't fetch it straight back).
 */

const CHECK_TIMEOUT_MS = 1500;
const LAUNCH_BUDGET_MS = 3500;

const enabled = !__DEV__ && Updates.isEnabled && !Updates.isEmergencyLaunch;

let pendingReload = false;
let busy = false;

const timeout = (ms: number) => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));

/** Check and download; resolves true when a new update is ready to run. */
async function fetchNewUpdate(checkTimeoutMs?: number): Promise<boolean> {
  const check = Updates.checkForUpdateAsync();
  const checked = checkTimeoutMs ? await Promise.race([check, timeout(checkTimeoutMs)]) : await check;
  if (checked === 'timeout' || !checked.isAvailable) return false;
  const result = await Updates.fetchUpdateAsync();
  return result.isNew;
}

async function launchCheck(): Promise<void> {
  if (!enabled) return;
  const started = Date.now();
  try {
    const download = fetchNewUpdate(CHECK_TIMEOUT_MS);
    const ready = await Promise.race([download, timeout(LAUNCH_BUDGET_MS)]);
    if (ready === true && Date.now() - started < LAUNCH_BUDGET_MS) {
      await Updates.reloadAsync();
      return;
    }
    // Too slow for this launch: let it finish and apply at the next background.
    download.then((isNew) => { if (isNew) pendingReload = true; }).catch(() => {});
  } catch {
    // Offline, server error: run what we have.
  }
}

/** Resolves when the launch check is done or has given up; the splash waits on it. */
export const launchUpdateGate: Promise<void> = enabled
  ? Promise.race([launchCheck(), timeout(LAUNCH_BUDGET_MS)]).then(() => undefined)
  : Promise.resolve();

let lastState: AppStateStatus = AppState.currentState;

if (enabled) {
  AppState.addEventListener('change', (next) => {
    const prev = lastState;
    lastState = next;
    if (next === 'background' && pendingReload) {
      pendingReload = false;
      Updates.reloadAsync().catch(() => {});
      return;
    }
    if (next === 'active' && prev === 'background' && !busy && !pendingReload) {
      busy = true;
      fetchNewUpdate()
        .then((isNew) => { if (isNew) pendingReload = true; })
        .catch(() => {})
        .finally(() => { busy = false; });
    }
  });
}
