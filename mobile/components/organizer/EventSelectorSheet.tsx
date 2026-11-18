import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal, FlatList, Animated } from 'react-native';
import { useSwipeToClose } from '../../hooks/useSwipeToClose';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../contexts/ThemeContext';
import { Touchable } from '../ui/Touchable';

export interface SelectableEvent {
  id: string;
  title: string;
  subtitle?: string;
}

interface EventSelectorSheetProps {
  visible: boolean;
  events: SelectableEvent[];
  onSelect: (event: SelectableEvent) => void;
  onClose: () => void;
  /** Optional currently-selected id — renders a trailing checkmark. */
  selectedId?: string;
  /** Sheet heading (defaults to "Select event"). */
  title?: string;
}

/**
 * A bottom-sheet modal listing events to pick from. Shared by OrganizerScan and
 * StaffScan. Neutral styling (raised surface, hairline row dividers) — the only
 * accent is the selected-row checkmark. Slides up from the bottom edge.
 */
export default function EventSelectorSheet({
  visible,
  events,
  onSelect,
  onClose,
  selectedId,
  title = 'Select event',
}: EventSelectorSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const swipe = useSwipeToClose(onClose, visible);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View style={[styles.sheet, swipe.sheetStyle, { paddingBottom: insets.bottom + 8 }]}>
          <View {...swipe.panHandlers}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Touchable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Touchable>
          </View>
          </View>

          <FlatList
            data={events}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Touchable
                  scale={false}
                  pressedColor={colors.surfaceRaised}
                  style={styles.row}
                  onPress={() => onSelect(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.title}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {!!item.subtitle && (
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    )}
                  </View>
                  {selected && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.text} />
                  )}
                </Touchable>
              );
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '70%',
      paddingTop: 8,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.border,
      marginBottom: 8,
    },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    rowSubtitle: {
      marginTop: 4,
      fontSize: 13,
      color: colors.textSecondary,
    },
  });

export { EventSelectorSheet };
