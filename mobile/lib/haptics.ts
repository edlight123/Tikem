/**
 * One place for haptics so the feel is the same everywhere. Every call is
 * fire-and-forget and never throws (simulators and old Androids have no motor).
 *
 *   success — the special moment: an RSVP confirmed, a ticket bought
 *   tapLight / select / warning / error — silent on purpose (see below)
 */
import * as Haptics from 'expo-haptics';

const safe = (p: Promise<unknown> | undefined) => {
  p?.catch?.(() => {});
};

// The phone vibrates only when a ticket lands (an RSVP confirmed, a purchase
// done). Presses, choices, switches and errors are silent; the names stay so
// the call sites keep compiling. (Port of Tikra de625ced.) The door scanner's
// valid / invalid buzz is separate (lib/scanner.ts) and stays: staff scan
// without looking at the screen.
const silent = () => {};
export const tapLight = silent;
export const select = silent;
export const success = () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const warning = silent;
export const error = silent;

export default { tapLight, select, success, warning, error };
