import { Vibration } from 'react-native';

/**
 * Door-scanner helpers shared by the camera path and the manual lookup path.
 *
 * Mirrors the web's `lib/scan/parseTicketId.ts` and the entry points / feedback
 * patterns of `components/scan/*`, so a ticket admitted on a phone and one
 * admitted through the web door mode leave the same record behind.
 */

/**
 * Pull a ticket id out of whatever the camera read. Same rules as the web's
 * `parseTicketId`: a /tickets/{id} URL, a JSON payload carrying the id, or a
 * bare id. Returns null when nothing usable is in the string.
 */
export function parseTicketId(scanResult: string): string | null {
  if (!scanResult) return null;
  const cleaned = String(scanResult).trim();

  try {
    const url = new URL(cleaned);
    const match = url.pathname.match(/\/tickets\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  } catch {
    // not a URL
  }

  try {
    const json = JSON.parse(cleaned);
    if (json && typeof json === 'object') {
      if (json.ticketId) return String(json.ticketId);
      if (json.ticket_id) return String(json.ticket_id);
      if (json.id) return String(json.id);
    }
  } catch {
    // not JSON
  }

  if (/^[a-zA-Z0-9_-]+$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Entry points offered at the door. The VALUE written to `tickets.entry_point`
 * is the canonical English name the web door mode writes
 * (components/scan/DoorModeInterface.tsx defaults), so reports read the same
 * whichever surface admitted the guest. Only the label shown is translated.
 */
export const ENTRY_POINTS = [
  { value: 'Main Entrance', labelKey: 'doorScanner.entryPoints.main' },
  { value: 'VIP Entrance', labelKey: 'doorScanner.entryPoints.vip' },
  { value: 'Gate A', labelKey: 'doorScanner.entryPoints.gateA' },
  { value: 'Gate B', labelKey: 'doorScanner.entryPoints.gateB' },
] as const;

export type ScanOutcome = 'valid' | 'warning' | 'invalid';

// expo-haptics is a native module. It ships in the store builds, but an OTA
// bundle can land on a binary without it, and requiring a missing native module
// throws at import. Resolve it lazily and fall back to plain vibration.
let haptics: any | null | undefined;
function getHaptics(): any | null {
  if (haptics !== undefined) return haptics;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    haptics = require('expo-haptics');
  } catch {
    haptics = null;
  }
  return haptics;
}

/** A light tick the instant the camera reads a code. */
export function scanReadFeedback(): void {
  const H = getHaptics();
  try {
    if (H?.impactAsync) {
      H.impactAsync(H.ImpactFeedbackStyle.Light).catch(() => Vibration.vibrate(60));
      return;
    }
  } catch {
    // fall through
  }
  Vibration.vibrate(60);
}

/**
 * The verdict, felt as well as seen: staff at a loud door often look at the
 * guest, not the phone. Same three patterns as the web overlay
 * (success / warning / error), with the native notification haptics when
 * available.
 */
export function scanOutcomeFeedback(outcome: ScanOutcome): void {
  const H = getHaptics();
  try {
    if (H?.notificationAsync) {
      const type =
        outcome === 'valid'
          ? H.NotificationFeedbackType.Success
          : outcome === 'warning'
            ? H.NotificationFeedbackType.Warning
            : H.NotificationFeedbackType.Error;
      H.notificationAsync(type).catch(() => vibrateFor(outcome));
      return;
    }
  } catch {
    // fall through
  }
  vibrateFor(outcome);
}

function vibrateFor(outcome: ScanOutcome) {
  if (outcome === 'valid') Vibration.vibrate(200);
  else if (outcome === 'warning') Vibration.vibrate([0, 100, 50, 100]);
  else Vibration.vibrate([0, 50, 50, 50, 50, 50]);
}
