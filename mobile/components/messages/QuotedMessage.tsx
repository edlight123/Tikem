import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors as T, radius, withAlpha } from '../../theme/tokens';
import { emojiSafe } from './types';

/**
 * The quoted message at the top of a bubble: who wrote it and its first line,
 * on a fill one step off the bubble's own (darker inside the white "mine"
 * bubble, the card step inside the raised "theirs" one). Display only: the
 * bubble's gesture decides what a tap on it does.
 */
export default function QuotedMessage({
  author,
  excerpt,
  onMine,
}: {
  author: string;
  excerpt: string;
  /** Sits inside the viewer's own (white) bubble. */
  onMine: boolean;
}) {
  return (
    <View style={[styles.box, onMine ? styles.boxMine : styles.boxTheirs]}>
      <Text style={[styles.author, onMine ? styles.authorMine : styles.authorTheirs]} numberOfLines={1}>
        {author}
      </Text>
      <Text
        style={[styles.excerpt, onMine ? styles.excerptMine : styles.excerptTheirs]}
        numberOfLines={2}
        textBreakStrategy="simple"
      >
        {emojiSafe(excerpt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 7 },
  boxMine: { backgroundColor: withAlpha(T.black, 0.07) },
  boxTheirs: { backgroundColor: T.surface },
  author: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  authorMine: { color: T.onWhite },
  authorTheirs: { color: T.textPrimary },
  excerpt: { fontSize: 13, lineHeight: 18, marginTop: 1, paddingRight: 1 },
  excerptMine: { color: T.onWhiteMuted },
  excerptTheirs: { color: T.textSecondary },
});
