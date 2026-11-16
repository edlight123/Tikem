/**
 * One place for haptics so the feel is the same everywhere. Every call is
 * fire-and-forget and never throws (simulators and old Androids have no motor).
 *
 *   tapLight  — any press (Touchable does this for you)
 *   select    — a choice changed: a tab, a segment, a switch, a chip
 *   success / warning / error — the result of an action the user waited on
 */
import * as Haptics from 'expo-haptics';

const safe = (p: Promise<unknown> | undefined) => {
  p?.catch?.(() => {});
};

export const tapLight = () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const select = () => safe(Haptics.selectionAsync());
export const success = () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const warning = () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
export const error = () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

export default { tapLight, select, success, warning, error };
