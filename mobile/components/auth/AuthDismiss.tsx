import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useI18n } from '../../contexts/I18nContext';
import { colors, spacing } from '../../theme/tokens';
import { clearPendingAuthIntent } from '../../lib/authGate';

/**
 * The way back out of the sign-in sheet for a guest who was browsing
 * (lib/authGate). Only shows when the sheet sits over something: the root
 * stack can go back from `Auth` to the screen the guest came from.
 *
 * - variant 'close': a line X pinned top-right over the photo band.
 * - variant 'link': the quiet "Not now, keep browsing" text under the form.
 */
export function AuthDismiss({
  navigation,
  variant,
  disabled,
}: {
  navigation: any;
  variant: 'close' | 'link';
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const root = navigation?.getParent?.();
  if (!root?.canGoBack?.()) return null;
  const dismiss = () => {
    // They chose to keep browsing: nothing to resume after a later sign-in.
    clearPendingAuthIntent();
    root.goBack();
  };

  if (variant === 'close') {
    return (
      <Pressable
        onPress={dismiss}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('auth.notNow')}
        style={[styles.close, { top: Math.max(insets.top, spacing.md) + spacing.xs }]}
      >
        <X size={24} color={colors.white} strokeWidth={1.75} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={dismiss}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      style={styles.link}
    >
      <Text style={styles.linkText}>{t('auth.notNow')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: {
    position: 'absolute',
    right: spacing.lg,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  link: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
