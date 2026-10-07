import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LucideIcon } from 'lucide-react-native';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * An icon may be:
 *  - a lucide component (e.g. `Calendar`) — matches the Dashboard's `icon={...}`,
 *  - an Ionicons glyph name (e.g. `"wallet-outline"`), or
 *  - any already-rendered node.
 */
export type ActionTileIcon =
  | LucideIcon
  | React.ComponentProps<typeof Ionicons>['name']
  | React.ReactNode;

export interface ActionTile {
  key: string;
  label: string;
  icon: ActionTileIcon;
  onPress: () => void;
}

interface ActionTileGridProps {
  tiles: ActionTile[];
  /**
   * `row` (default): two columns of compact icon + label rows.
   * `stacked`: square-ish tiles with the icon above the label, in `columns`
   * columns, the quick-actions grid from the organizer redesign.
   * `compact`: two columns of short filled tiles (icon left, label right,
   * label wraps to two lines so it never truncates). An odd last tile spans
   * the full width so the grid never ends on an orphan.
   */
  variant?: 'row' | 'stacked' | 'compact';
  /** Columns for the stacked variant (default 3). */
  columns?: 2 | 3;
}

function renderIcon(icon: ActionTileIcon, color: string): React.ReactNode {
  // Ionicons glyph name.
  if (typeof icon === 'string') {
    return <Ionicons name={icon as any} size={19} color={color} />;
  }
  // Lucide (or any) component reference.
  if (typeof icon === 'function') {
    const IconComp = icon as LucideIcon;
    return <IconComp size={19} color={color} />;
  }
  // Already-rendered node.
  return icon as React.ReactNode;
}

/**
 * A 2-column grid of tappable action tiles. Tiles are neutral raised surfaces
 * with `text`-colored icons — teal is never used as a tile fill or icon color.
 */
export default function ActionTileGrid({ tiles, variant = 'row', columns = 3 }: ActionTileGridProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const stacked = variant === 'stacked';
  const stackedWidth = columns === 2 ? '48.5%' : '32%';

  if (variant === 'compact') {
    // Pair tiles into explicit rows (flex: 1 each) rather than percent widths,
    // so a lone last tile simply fills its row instead of sitting half-empty.
    const rows: ActionTile[][] = [];
    for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
    return (
      <View style={styles.compactGrid}>
        {rows.map((row) => (
          <View key={row.map((r) => r.key).join('|')} style={styles.compactRow}>
            {row.map((tile) => (
              <TouchableOpacity
                key={tile.key}
                style={styles.tileCompact}
                onPress={tile.onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={tile.label}
              >
                <View style={styles.iconWrapCompact}>{renderIcon(tile.icon, colors.text)}</View>
                <Text style={styles.labelCompact} numberOfLines={2}>
                  {tile.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.grid, stacked && styles.gridStacked]}>
      {tiles.map((tile) => (
        <TouchableOpacity
          key={tile.key}
          style={stacked ? [styles.tileStacked, { width: stackedWidth }, columns === 2 && styles.tileStackedWide] : styles.tile}
          onPress={tile.onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={tile.label}
        >
          <View style={styles.iconWrap}>{renderIcon(tile.icon, colors.text)}</View>
          <Text
            style={stacked ? (columns === 2 ? styles.labelStackedWide : styles.labelStacked) : styles.label}
            numberOfLines={1}
          >
            {tile.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    tile: {
      // Two columns; a compact horizontal row (icon + label) instead of a tall
      // stacked tile — reads tighter and more polished with 8+ actions.
      width: '48%',
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingVertical: 13,
      paddingHorizontal: 14,
      gap: 10,
    },
    // Percent widths plus a fixed column gap overflow on narrow phones, so the
    // stacked grid spaces its columns with space-between and keeps only a row gap.
    gridStacked: {
      columnGap: 0,
      rowGap: 10,
      justifyContent: 'space-between',
    },
    // Stacked: icon over label, centred, tall enough to read as a tile.
    tileStacked: {
      aspectRatio: 1.05,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      paddingHorizontal: 8,
      gap: 10,
    },
    // Two-column stacked tiles sit the icon top-left with the label at the
    // foot, like the dashboard's manage grid.
    tileStackedWide: {
      aspectRatio: 1.7,
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    labelStacked: {
      fontSize: 12.5,
      fontWeight: '500',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    labelStackedWide: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    iconWrap: {
      width: 19,
      height: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    compactGrid: {
      gap: 10,
    },
    compactRow: {
      flexDirection: 'row',
      gap: 10,
    },
    // Compact: a short filled tile, icon left and label right. minHeight (not a
    // fixed height) so a two-line label grows the tile instead of clipping.
    tileCompact: {
      flex: 1,
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      paddingVertical: 10,
      paddingHorizontal: 14,
      gap: 12,
    },
    iconWrapCompact: {
      width: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    labelCompact: {
      flex: 1,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '600',
      color: colors.text,
    },
    label: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.text,
    },
  });

export { ActionTileGrid };
