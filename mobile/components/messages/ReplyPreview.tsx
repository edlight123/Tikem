import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors as T, radius } from '../../theme/tokens';
import { Touchable } from '../ui/Touchable';
import { emojiSafe, fill, type MessageStrings } from './types';

/** Above the composer while replying to a message: who and what, with a ×. */
export default function ReplyPreview({
  author,
  excerpt,
  strings,
  onDismiss,
}: {
  author: string;
  excerpt: string;
  strings: MessageStrings;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.text}>
        <Text style={styles.author} numberOfLines={1}>
          {fill(strings.replyingTo, { name: author })}
        </Text>
        <Text style={styles.excerpt} numberOfLines={1} textBreakStrategy="simple">
          {emojiSafe(excerpt)}
        </Text>
      </View>
      <Touchable
        style={styles.close}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={strings.cancelReply}
      >
        <X size={18} color={T.textSecondary} strokeWidth={1.75} />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 2,
    paddingVertical: 4,
    marginBottom: 8,
    borderRadius: radius.md,
    backgroundColor: T.surface,
  },
  text: { flex: 1, minWidth: 0 },
  author: { fontSize: 12, fontWeight: '600', color: T.textSecondary, lineHeight: 16 },
  excerpt: { fontSize: 13, lineHeight: 18, color: T.textTertiary },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
