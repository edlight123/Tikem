import React from 'react';
import {
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, type } from '../theme/tokens';
import { Touchable } from './ui/Touchable';

export type WhitePillVariant = 'paid' | 'rsvp' | 'default';

interface WhitePillCTAProps {
  /** Primary label, e.g. "Achte tikè" | "RSVP". */
  label: string;
  /** Muted inline sub-label, e.g. a price "apati 1,500 HTG" (typically paid only). */
  subLabel?: string;
  onPress?: () => void;
  /** Semantic variant. Affects intent/labelling only — the pill is always white. */
  variant?: WhitePillVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon (rendered black to match the label). */
  icon?: React.ReactNode;
  /** Compact size — a shorter, tighter pill for dense contexts (e.g. feed cards). */
  compact?: boolean;
  style?: ViewStyle;
}

/**
 * The single primary action per screen (POSH §2.2): a solid WHITE pill with
 * BLACK text, ~56px tall, fully rounded, bold. Teal is deliberately NOT used
 * here — the primary action is white so the poster art stays the only color.
 *
 * `subLabel` renders inline, muted (black-60), stating the commitment, e.g.
 *   Achte tikè · apati 1,500 HTG
 */
export default function WhitePillCTA({
  label,
  subLabel,
  onPress,
  variant = 'default',
  disabled = false,
  loading = false,
  icon,
  compact = false,
  style,
}: WhitePillCTAProps) {
  const isDisabled = disabled || loading;

  return (
    <Touchable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={subLabel ? `${label}, ${subLabel}` : label}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.onWhite} />
      ) : (
        <>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={1}>
            {label}
          </Text>
          {subLabel ? (
            <Text style={[styles.subLabel, compact && styles.subLabelCompact]} numberOfLines={1}>
              {subLabel}
            </Text>
          ) : null}
        </>
      )}
    </Touchable>
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
    backgroundColor: colors.white,
  },
  buttonCompact: {
    height: 46,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
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
    fontWeight: '700',
    color: colors.onWhite,
  },
  labelCompact: {
    fontSize: 14,
  },
  subLabel: {
    ...type.label,
    fontSize: 14,
    fontWeight: '500',
    color: colors.onWhiteMuted,
  },
  subLabelCompact: {
    fontSize: 12,
  },
});
