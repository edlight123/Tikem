import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Touchable } from './ui/Touchable';
import { ChevronDown, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';

interface FilterPillProps {
  /** Default label shown when no value is selected (e.g. "Where"). */
  label: string;
  /** Selected value label; when set, the pill renders active/teal. */
  value?: string | null;
  onPress: () => void;
  /** Optional clear handler — shows an × when active. */
  onClear?: () => void;
}

/**
 * Compact, Posh-style dropdown filter pill. A quiet fill when empty; flips to
 * solid white with the chosen value when active (teal stays a rare accent).
 */
export default function FilterPill({ label, value, onPress, onClear }: FilterPillProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const active = !!value;

  return (
    <Touchable
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}: ${value}` : label}
    >
      <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
        {active ? value : label}
      </Text>
      {active && onClear ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
          style={styles.clearBtn}
        >
          <X size={14} color="#000000" />
        </TouchableOpacity>
      ) : (
        <ChevronDown size={15} color={active ? '#000000' : colors.textSecondary} />
      )}
    </Touchable>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    pillActive: {
      backgroundColor: '#FFFFFF',
    },
    text: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      maxWidth: 150,
    },
    textActive: {
      color: '#000000',
    },
    clearBtn: {
      marginLeft: -1,
    },
  });
