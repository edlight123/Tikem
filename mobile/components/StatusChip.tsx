import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

export interface StatusTone {
  /** Solid dot + text color. */
  color: string;
  /** Subtle chip fill (low-opacity tint of `color`). */
  fill: string;
  /** Canonical default label for this status. */
  defaultLabel: string;
}

/**
 * Locked semantic color map (POSH §2.7) — the same color never means two
 * things. Any unknown status falls back to the neutral/grey tone.
 *
 *   live / upcoming              → teal
 *   action-needed / pending      → amber
 *   error / void / declined /
 *     sold-out                   → red
 *   verified                     → teal (gold available via `colors.gold`)
 *   success / paid               → emerald
 *   used / expired /
 *     neutral / default          → grey
 */
export function statusTone(status: string): StatusTone {
  const key = String(status).toLowerCase().replace(/[\s_-]+/g, '');

  switch (key) {
    case 'live':
      return { color: colors.accent, fill: colors.accentMuted, defaultLabel: 'Live' };
    case 'upcoming':
      return { color: colors.accent, fill: colors.accentMuted, defaultLabel: 'Upcoming' };
    case 'active':
      return { color: colors.accent, fill: colors.accentMuted, defaultLabel: 'Active' };
    case 'verified':
      return { color: colors.accent, fill: colors.accentMuted, defaultLabel: 'Verified' };

    case 'actionneeded':
      return { color: colors.amber, fill: colors.amberMuted, defaultLabel: 'Action needed' };
    case 'pending':
      return { color: colors.amber, fill: colors.amberMuted, defaultLabel: 'Pending' };

    case 'error':
      return { color: colors.red, fill: colors.redMuted, defaultLabel: 'Error' };
    case 'void':
      return { color: colors.red, fill: colors.redMuted, defaultLabel: 'Void' };
    case 'declined':
      return { color: colors.red, fill: colors.redMuted, defaultLabel: 'Declined' };
    case 'soldout':
      return { color: colors.red, fill: colors.redMuted, defaultLabel: 'Sold out' };

    case 'success':
      return { color: colors.emerald, fill: colors.emeraldMuted, defaultLabel: 'Success' };
    case 'paid':
      return { color: colors.emerald, fill: colors.emeraldMuted, defaultLabel: 'Paid' };

    case 'used':
      return { color: colors.textSecondary, fill: colors.neutralMuted, defaultLabel: 'Used' };
    // Grey, not red: a ticket for an event that already happened is history,
    // not a fault the attendee can act on. Red is reserved for states that
    // demand a response (void, declined, error). The LABEL still says Expired
    // — "Used" would claim a scan that never happened.
    case 'expired':
      return { color: colors.textSecondary, fill: colors.neutralMuted, defaultLabel: 'Expired' };
    case 'neutral':
    default:
      return { color: colors.textSecondary, fill: colors.neutralMuted, defaultLabel: status };
  }
}

interface StatusChipProps {
  status: string;
  /** Overrides the canonical label for this status. */
  label?: string;
}

/**
 * A small dot + uppercase label, rendered inline with NO background fill
 * (platform-wide de-pill). Never color-only — the text label always ships
 * alongside the dot so meaning is legible without relying on color.
 */
export default function StatusChip({ status, label }: StatusChipProps) {
  const tone = statusTone(status);
  const text = label ?? tone.defaultLabel;

  return (
    <View
      style={styles.chip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      <View style={[styles.dot, { backgroundColor: tone.color }]} />
      <Text style={[styles.label, { color: tone.color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
