import { Platform, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding that keeps a sheet's footer clear of Android's system bar.
 *
 * The app draws edge to edge on Android (app.json edgeToEdgeEnabled), so a
 * bottom sheet or a full-screen modal reaches under the gesture / 3-button
 * bar and its last button sat behind it. Returns
 * `{ paddingBottom: max(base, inset + gap) }` on Android, where `base` is the
 * padding the sheet already has; on iOS (already laid out around the home
 * indicator) and when there is no inset it returns undefined, so the sheet's
 * own style stands. Spread it AFTER the sheet's style.
 */
export function useAndroidBottomInset(base = 0, gap = 16): ViewStyle | undefined {
  const { bottom } = useSafeAreaInsets();
  if (Platform.OS !== 'android' || bottom <= 0) return undefined;
  return { paddingBottom: Math.max(base, bottom + gap) };
}
