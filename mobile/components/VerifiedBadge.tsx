import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { useI18n } from '../contexts/I18nContext';

export type VerifiedBadgeSize = 'small' | 'medium' | 'large';

interface VerifiedBadgeProps {
  /** Show the "Verified" text alongside the shield (default: icon only). */
  showLabel?: boolean;
  /** Override the label text (defaults to the translated "Verified"). */
  label?: string;
  size?: VerifiedBadgeSize;
  style?: ViewStyle;
}

const SIZES: Record<VerifiedBadgeSize, { icon: number; font: number }> = {
  small: { icon: 12, font: 10 },
  medium: { icon: 14, font: 11 },
  large: { icon: 18, font: 13 },
};

/**
 * The one verified marker (POSH §2.7). Consolidates the ad-hoc Shield /
 * ShieldCheck marks scattered across screens into a single teal badge — teal
 * here CARRIES MEANING (this account is verified), which is exactly what the
 * accent is reserved for.
 */
export default function VerifiedBadge({
  showLabel = false,
  label: labelProp,
  size = 'small',
  style,
}: VerifiedBadgeProps) {
  const dims = SIZES[size];
  // Translated by default (TestFlight 2026-11-24: "VERIFIED" in English on a
  // French org page). fr "Vérifié", ht "Verifye".
  const { t } = useI18n();
  const label = labelProp ?? t('organizerProfile.verified');

  if (!showLabel) {
    return (
      <ShieldCheck
        size={dims.icon}
        color={colors.accent}
        accessibilityLabel={label}
        style={style}
      />
    );
  }

  return (
    <View
      style={[styles.pill, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <ShieldCheck size={dims.icon} color={colors.accent} />
      <Text style={[styles.label, { fontSize: dims.font }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately NOT a filled pill: the owner's standing rule is a mark + label,
  // never a tinted capsule. The teal shield already carries the meaning, so the
  // background was doing nothing but adding weight.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  label: {
    color: colors.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
