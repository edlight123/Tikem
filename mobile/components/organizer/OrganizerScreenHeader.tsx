import React from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font } from '../../theme/tokens';
import { useTheme } from '../../contexts/ThemeContext';
import ChromeBlur from '../ChromeBlur';
import { Touchable } from '../ui/Touchable';

interface OrganizerScreenHeaderProps {
  title: string;
  /** Optional muted line under the title. */
  subtitle?: string;
  /** When provided, renders a leading chevron-back button. */
  onBack?: () => void;
  /** Optional node pinned to the trailing edge (icon button, chip, etc.). */
  right?: React.ReactNode;
  /**
   * Float over the content with the app's blurred chrome instead of sitting in
   * flow behind a hairline.
   *
   * Opt-in per screen, because it only works if the screen ALSO reserves the
   * header's height on its scroll container — otherwise the first row is born
   * hidden underneath. Use `onHeight` to get that measurement.
   */
  overlay?: boolean;
  /** Measured height including the safe-area inset. Pair with `overlay`. */
  onHeight?: (h: number) => void;
  /**
   * The owning screen's scroll offset (overlay mode only). When given, the
   * chrome is a UNIFORM solid canvas at rest and only turns translucent once
   * content has scrolled underneath (fades over the first 24pt).
   */
  scrollY?: Animated.Value;
}

/**
 * The organizer-surface header: a serif (Instrument Serif) title on a neutral
 * canvas, an optional chevron back button, and an optional right slot. Safe-area
 * aware (pads for the notch) and separated from the content by a single hairline
 * — never a teal block or a heavy bar.
 */
export default function OrganizerScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  overlay = false,
  onHeight,
  scrollY,
}: OrganizerScreenHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const restOpacity = scrollY
    ? scrollY.interpolate({ inputRange: [0, 24], outputRange: [1, 0], extrapolate: 'clamp' })
    : undefined;

  return (
    <View
      style={[
        styles.container,
        overlay ? styles.overlay : styles.inFlow,
        { paddingTop: insets.top + 8 },
      ]}
      onLayout={
        onHeight
          ? (e: LayoutChangeEvent) => {
              const h = e?.nativeEvent?.layout?.height ?? 0;
              if (h) onHeight(h);
            }
          : undefined
      }
    >
      {overlay ? <ChromeBlur edge="top" restOpacity={restOpacity} /> : null}
      <View style={styles.row}>
        {onBack ? (
          <Touchable
            onPress={onBack}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Touchable>
        ) : null}

        <View style={styles.titleCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    // Overlaid: ChromeBlur is the backdrop, so no fill and no hairline — a
    // border drawn over a blur reads as a seam. NO overflow: 'hidden' here;
    // the blur's fade sits outside this box and clipping would erase it.
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
    },
    // In flow: unchanged from before — opaque canvas plus a single hairline.
    inFlow: {
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    backButton: {
      marginLeft: -6,
    },
    titleCol: {
      flex: 1,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 28,
      lineHeight: 34,
      color: colors.text,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    right: {
      marginLeft: 'auto',
    },
  });

export { OrganizerScreenHeader };
