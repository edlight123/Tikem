/**
 * Copy text, ONLY when a clipboard native module is in this binary.
 *
 * The app ships no clipboard package (no expo-clipboard). React Native itself
 * still carries its deprecated Clipboard module (RCTClipboard on iOS,
 * ClipboardModule on Android), so it is normally present, but an OTA update
 * must never assume a native module: we look it up first and the caller hides
 * "Copy" when this says no. Requiring the JS wrapper of a missing TurboModule
 * would throw (getEnforcing), so the lookup comes before the require.
 */
import { NativeModules, TurboModuleRegistry } from 'react-native';

type ClipboardLike = { setString: (text: string) => void };

let cached: ClipboardLike | null | undefined;

function nativePresent(): boolean {
  try {
    return !!(TurboModuleRegistry.get('Clipboard') || (NativeModules as Record<string, unknown>).Clipboard);
  } catch {
    return false;
  }
}

function clipboard(): ClipboardLike | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!nativePresent()) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native/Libraries/Components/Clipboard/Clipboard');
    const cb = (mod?.default ?? mod) as ClipboardLike | undefined;
    if (cb && typeof cb.setString === 'function') cached = cb;
  } catch {
    cached = null;
  }
  return cached;
}

/** Can this build copy at all? Decides whether "Copy" is offered. */
export function canCopy(): boolean {
  return clipboard() !== null;
}

/** False when there is no clipboard or the copy failed. */
export function copyText(text: string): boolean {
  const cb = clipboard();
  if (!cb) return false;
  try {
    cb.setString(text);
    return true;
  } catch {
    return false;
  }
}
