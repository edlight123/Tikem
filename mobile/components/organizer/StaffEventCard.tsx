import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { radius } from '../../theme/tokens';

interface StaffEventCardProps {
  title: string;
  /** Secondary line, e.g. venue • city. */
  subtitle?: string;
  /** Tertiary muted line, e.g. a date or "Tap to open scanner". */
  meta?: string;
  /**
   * Event poster (banner_image_url || cover_image_url). Pass a value (or null)
   * to opt into the poster tile — null renders an icon fallback. Omit entirely
   * for non-event rows (people, invites), which stay text-only.
   */
  posterUri?: string | null;
  onPress?: () => void;
  /** Trailing node (chevron, status chip, checkmark, etc.). */
  right?: React.ReactNode;
  /**
   * 'plain' (default): the background-less row used by team / invite lists.
   * 'surface': a compact filled row (surface fill, radius 16) with a square
   * poster thumb and a trailing chevron when tappable and no `right` is given.
   */
  variant?: 'plain' | 'surface';
}

/**
 * A poster-forward, background-less event row for staff / scan / team lists
 * (beta feedback: no gray box backgrounds; "I would like to see the event
 * poster"). The poster carries the row, like My Events and the Earnings hub.
 */
export default function StaffEventCard({
  title,
  subtitle,
  meta,
  posterUri,
  onPress,
  right,
  variant = 'plain',
}: StaffEventCardProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const isSurface = variant === 'surface';
  const posterStyle = isSurface ? [styles.poster, styles.posterSquare] : styles.poster;
  const trailing =
    right ??
    (isSurface && onPress ? (
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    ) : null);

  return (
    <TouchableOpacity
      style={[styles.card, isSurface && styles.cardSurface]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {posterUri !== undefined &&
        (posterUri ? (
          <Image
            source={{ uri: posterUri }}
            style={posterStyle}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={posterUri}
          />
        ) : (
          <View style={[posterStyle, styles.posterFallback]}>
            <Ionicons name="image-outline" size={16} color={colors.textTertiary} />
          </View>
        ))}
      <View style={styles.textCol}>
        <Text style={[styles.title, isSurface && styles.titleSurface]} numberOfLines={2}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {!!meta && (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {trailing ? <View style={styles.right}>{trailing}</View> : null}
    </TouchableOpacity>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
    },
    // Fill, never a hairline (POSH): the compact staff-events row.
    cardSurface: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 12,
      paddingRight: 14,
    },
    poster: {
      width: 56,
      height: 74,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    posterSquare: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
    },
    posterFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    textCol: {
      flex: 1,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    titleSurface: {
      fontSize: 17,
      letterSpacing: -0.2,
    },
    subtitle: {
      marginTop: 4,
      fontSize: 13,
      color: colors.textSecondary,
    },
    meta: {
      marginTop: 3,
      fontSize: 12,
      color: colors.textTertiary,
    },
    right: {
      marginLeft: 'auto',
    },
  });

export { StaffEventCard };
