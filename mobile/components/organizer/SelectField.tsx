import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../contexts/ThemeContext';

interface SelectFieldProps {
  /** Optional label rendered above the field. */
  label?: string;
  /** Currently selected value ('' when nothing chosen yet). */
  value: string;
  /** The options to choose from. */
  options: string[];
  /** Fired with the chosen option string. */
  onSelect: (value: string) => void;
  /** Placeholder shown when `value` is empty. */
  placeholder?: string;
  /** Sheet heading (defaults to the label, then "Select"). */
  sheetTitle?: string;
  /** Overrides so a host form can match its own labels and filled inputs. */
  labelStyle?: StyleProp<TextStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
}

/**
 * A tappable field that opens a bottom-sheet Modal listing `options`. Mirrors the
 * neutral styling of EventSelectorSheet — raised surface, hairline row dividers,
 * and the only accent being the selected-row checkmark (no teal fill). The field
 * itself matches the screen's text inputs so it reads as one form control.
 */
export default function SelectField({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select…',
  sheetTitle,
  labelStyle,
  fieldStyle,
}: SelectFieldProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const [open, setOpen] = useState(false);

  const handleSelect = (option: string) => {
    onSelect(option);
    setOpen(false);
  };

  return (
    <>
      {!!label && <Text style={[styles.label, labelStyle]}>{label}</Text>}

      <TouchableOpacity
        style={[styles.field, fieldStyle]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label || placeholder}
        accessibilityValue={{ text: value || placeholder }}
      >
        <Text
          style={[styles.fieldText, !value && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title}>{sheetTitle || label || 'Select'}</Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const selected = item === value;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handleSelect(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={item}
                  >
                    <Text style={styles.rowText} numberOfLines={1}>
                      {item}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={22} color={colors.text} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    label: {
      marginTop: 16,
      marginBottom: 8,
      color: colors.text,
      fontWeight: '600',
      fontSize: 14,
    },
    field: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      minHeight: 48,
    },
    fieldText: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
    },
    fieldPlaceholder: {
      color: colors.textTertiary,
    },
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
      fontSize: 16,
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
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
  });

export { SelectField };
