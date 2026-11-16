import React from 'react';
import {
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, type } from '../theme/tokens';
import { Touchable } from './ui/Touchable';

interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /**
   * 'solid' (teal), 'outline' (teal text on transparent), or 'white' (solid
   * white pill, black label — the POSH primary that keeps teal off the CTA).
   * Default is 'white' (POSH: teal is a sparing accent, not the CTA).
   */
  variant?: 'solid' | 'outline' | 'white';
  /**
   * Pin to the bottom safe-area as a sticky CTA (event detail "Get Tickets").
   * Adds a dark bar + hairline top border behind the button.
   */
  sticky?: boolean;
  style?: ViewStyle;
}

/**
 * The single primary call-to-action: a solid white button with black text by
 * default (teal on request). Spring + haptic press via Touchable.
 */
export default function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  variant = 'white',
  sticky = false,
  style,
}: PrimaryButtonProps) {
  const insets = useSafeAreaInsets();
  const isOutline = variant === 'outline';
  const isWhite = variant === 'white';

  const surfaceStyle = isOutline ? styles.outline : isWhite ? styles.white : styles.solid;
  const labelStyle = isOutline ? styles.labelOutline : isWhite ? styles.labelWhite : styles.labelSolid;
  const spinnerColor = isOutline ? colors.teal : isWhite ? colors.onWhite : colors.onTeal;

  const button = (
    <Touchable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        surfaceStyle,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text style={[styles.label, labelStyle]}>
            {label}
          </Text>
        </>
      )}
    </Touchable>
  );

  if (!sticky) return button;

  return (
    <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {button}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  solid: {
    backgroundColor: colors.teal,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.teal,
  },
  white: {
    backgroundColor: colors.white,
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    marginLeft: -2,
  },
  label: {
    ...type.title,
    fontSize: 16,
  },
  labelSolid: {
    color: colors.onTeal,
  },
  labelOutline: {
    color: colors.teal,
  },
  labelWhite: {
    color: colors.onWhite,
  },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
