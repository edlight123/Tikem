import React from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { X, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { font, radius } from '../../theme/tokens';
import { Touchable } from './Touchable';

export interface NoticeStripProps {
  /** A small line icon (16px, thin stroke). No tile behind it. */
  icon?: LucideIcon;
  /** Or any small leading node (a flag, a 32px poster thumb). Wins over `icon`. */
  leading?: React.ReactNode;
  /** One short sentence. Wraps to two lines at most (never cut mid-word on a phone). */
  text: string;
  /** A few muted words after the sentence, on the same line ("Today"). */
  sub?: string;
  /** Use the serif for `text` (a poster-ish title, e.g. a national day). */
  serif?: boolean;
  /** One quiet text link on the right ("Settings", "Find", "See"). */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Shows a small × when given. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Makes the whole strip tappable (in addition to the action link). */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The house notice (owner, TestFlight 2026-11-25: "no big ass card like this").
 * Every one-time notice, nudge or prompt in the app is this strip and nothing
 * bigger: a filled row (never a hairline box), 4px corners, 48pt tall at
 * every width (the sentence wraps to a second line only on a narrow phone), a
 * thin line icon with no tile, one short sentence, at most one quiet text
 * action and a small ×. No eyebrow, no headline + paragraph stack, no white
 * button, no fixed widths: it fills its container on a phone or a tablet.
 */
export function NoticeStrip({
  icon: Icon,
  leading,
  text,
  sub,
  serif,
  action,
  onDismiss,
  dismissLabel,
  onPress,
  accessibilityLabel,
  style,
}: NoticeStripProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const body = (
    <>
      {leading ?? (Icon ? <Icon size={16} color={colors.textSecondary} strokeWidth={1.75} /> : null)}
      <View style={styles.words}>
        <Text style={[styles.text, serif && styles.serif]} numberOfLines={2}>
          {text}
          {!!sub && <Text style={styles.sub}>{`  ·  ${sub}`}</Text>}
        </Text>
      </View>
    </>
  );

  return (
    <View style={[styles.strip, style]}>
      {onPress ? (
        <Touchable
          style={styles.main}
          scale={false}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? text}
        >
          {body}
        </Touchable>
      ) : (
        <View style={styles.main} accessible accessibilityLabel={accessibilityLabel ?? text}>
          {body}
        </View>
      )}
      {action && (
        <Touchable
          onPress={action.onPress}
          scale={false}
          style={styles.action}
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
        >
          <Text style={styles.actionText} numberOfLines={1}>
            {action.label}
          </Text>
        </Touchable>
      )}
      {onDismiss && (
        <Touchable
          onPress={onDismiss}
          scale={false}
          style={styles.close}
          hitSlop={{ top: 12, bottom: 12, left: 4, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
        >
          <X size={14} color={colors.textTertiary} strokeWidth={1.75} />
        </Touchable>
      )}
    </View>
  );
}

export default NoticeStrip;

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingVertical: 4,
      paddingLeft: 14,
      paddingRight: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
    words: { flex: 1, minWidth: 0 },
    text: { fontSize: 14, lineHeight: 18, color: colors.text },
    serif: { fontFamily: font.serif, fontSize: 17, lineHeight: 20 },
    // Inline after the sentence, in the sans even when the sentence is serif.
    sub: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' }), fontStyle: 'normal', fontSize: 13, color: colors.textSecondary },
    action: { height: 40, paddingHorizontal: 10, justifyContent: 'center' },
    actionText: { fontSize: 14, fontWeight: '600', color: colors.text },
    close: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  });
