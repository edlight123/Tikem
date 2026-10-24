// Status for an attend request: a small dot + an uppercase label, never a pill
// (no-status-pills rule). Amber pending, emerald approved, grey declined: a
// declined request is the host's answer, not an error the guest can fix.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors as T } from '../theme/tokens';

export type RequestTone = 'pending' | 'approved' | 'declined';

export function requestToneColor(tone: RequestTone): string {
  if (tone === 'approved') return T.emerald;
  if (tone === 'declined') return T.textTertiary;
  return T.amber;
}

export function requestTone(status: string | null | undefined): RequestTone {
  if (status === 'approved') return 'approved';
  if (status === 'declined') return 'declined';
  return 'pending';
}

export default function RequestStatusDot({ tone, label }: { tone: RequestTone; label: string }) {
  const color = requestToneColor(tone);
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color: tone === 'declined' ? T.textSecondary : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
});
