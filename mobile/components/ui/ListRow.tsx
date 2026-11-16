/**
 * ListRow + ListGroup — the settings / menu idiom (learned from EdLight Code).
 *
 * Rows sit in ONE filled surface (no border around the box); the only
 * hairlines are the inset dividers BETWEEN rows. 52pt min height (64 with a
 * subtitle). Rows don't bounce: pressing fills the row instead.
 *
 *   <ListGroup>
 *     <ListRow icon={Bell} title="Notifications" onPress={…} />
 *     <ListRow icon={Moon} title="Quiet hours" trailing={<Switch … />} />
 *   </ListGroup>
 */
import React, { Children, Fragment, isValidElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { colors as T, radius } from '../../theme/tokens';
import { Text } from './Text';
import { Touchable } from './Touchable';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** A lucide icon drawn in a quiet tile on the left. */
  icon?: LucideIcon;
  /** Or any leading element (avatar…). Wins over `icon`. */
  leading?: React.ReactNode;
  /** Short trailing value ("English", "3"). */
  value?: string;
  /** A custom trailing element (Switch…). */
  trailing?: React.ReactNode;
  /** Chevron: defaults to shown when the row navigates (onPress, no trailing). */
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  icon: Icon,
  leading,
  value,
  trailing,
  chevron,
  onPress,
  disabled,
  destructive,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const { colors } = useTheme();
  const showChevron = chevron ?? (!!onPress && !trailing);
  const tint = destructive ? colors.error : colors.text;

  const content = (
    <>
      {leading ??
        (Icon ? (
          <View style={styles.iconTile}>
            <Icon size={18} color={destructive ? colors.error : colors.textSecondary} strokeWidth={1.75} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="body" color={disabled ? colors.textTertiary : tint} style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="meta" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <ChevronRight size={18} color={colors.textTertiary} /> : null}
    </>
  );

  const rowStyle = [styles.row, { minHeight: subtitle ? 64 : 52 }];
  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      scale={false}
      pressedColor={T.surfaceRaised}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      testID={testID}
      style={rowStyle}
    >
      {content}
    </Touchable>
  );
}

/** One filled surface holding rows, with inset hairlines between them. */
export function ListGroup({
  children,
  style,
  inset,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Left inset of the dividers. Defaults to past the icon tile (60). */
  inset?: number;
}) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, style]}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i > 0 ? <View style={[styles.divider, { marginLeft: inset ?? 60 }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { fontWeight: '500' },
  value: { maxWidth: '40%' },
  group: { backgroundColor: T.surface, borderRadius: radius.md, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: T.border },
});

export default ListRow;
