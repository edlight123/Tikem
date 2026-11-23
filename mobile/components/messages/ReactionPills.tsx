import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors as T, radius } from '../../theme/tokens';
import { Touchable } from '../ui/Touchable';
import { emojiSafe, fill, type MessageStrings, type Reaction, type ReactionSummary } from './types';

/**
 * The reactions under a bubble: one small fill per emoji, with a count once
 * more than one person chose it. Your own is the teal-tinted one (an active
 * state, the accent's job); tapping any toggles that reaction. Read-only when
 * `onToggle` is omitted (a blocked thread).
 */
export default function ReactionPills({
  reactions,
  alignRight,
  strings,
  onToggle,
}: {
  reactions: ReactionSummary[];
  alignRight: boolean;
  strings: MessageStrings;
  onToggle?: (emoji: Reaction) => void;
}) {
  if (!reactions.length) return null;
  return (
    <View style={[styles.row, alignRight ? styles.right : styles.left]}>
      {reactions.map((r) => (
        <Touchable
          key={r.emoji}
          style={[styles.pill, r.mine ? styles.pillMine : styles.pillOther]}
          onPress={onToggle ? () => onToggle(r.emoji) : undefined}
          disabled={!onToggle}
          scale={0.94}
          accessibilityRole="button"
          accessibilityState={{ selected: r.mine, disabled: !onToggle }}
          accessibilityLabel={fill(strings.reactionCount, { emoji: r.emoji, count: r.count })}
        >
          <Text style={styles.emoji} textBreakStrategy="simple">
            {emojiSafe(r.emoji)}
          </Text>
          {r.count > 1 ? <Text style={[styles.count, r.mine && styles.countMine]}>{r.count}</Text> : null}
        </Touchable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: radius.sm,
  },
  pillOther: { backgroundColor: T.surfaceRaised },
  pillMine: { backgroundColor: T.tealMuted },
  // Room for the colour glyph: a line height tighter than the emoji font clips it on Android.
  emoji: { fontSize: 13, lineHeight: 18, paddingRight: 1, includeFontPadding: false },
  count: { fontSize: 12, fontWeight: '600', color: T.textSecondary, fontVariant: ['tabular-nums'] },
  countMine: { color: T.teal },
});
