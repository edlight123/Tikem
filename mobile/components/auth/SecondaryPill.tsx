import React from 'react';
import { Text, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, type } from '../../theme/tokens';

interface SecondaryPillProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Optional leading icon (rendered as-is). */
  icon?: React.ReactNode;
  /** 'sm' pairs with WhitePillCTA size="sm" (44pt, 15pt semibold). */
  size?: 'md' | 'sm';
  style?: ViewStyle;
}

/**
 * The design-system SECONDARY action (POSH §2.2): a dark-grey pill — an
 * elevated surface with a subtle hairline, white label — never teal. Same
 * 56px height and pill radius as the white primary so the button stack reads
 * as one system. Used for "Continue with Google" and the future Apple button.
 */
export function SecondaryPill({
  label,
  onPress,
  disabled = false,
  icon,
  size = 'md',
  style,
}: SecondaryPillProps) {
  const small = size === 'sm';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, small && styles.labelSmall]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.button,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  buttonSmall: {
    height: 44,
    paddingHorizontal: 20,
    gap: 6,
  },
  labelSmall: {
    fontSize: 15,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.85,
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
    fontWeight: '600',
    color: colors.textPrimary,
  },
});

export default SecondaryPill;
