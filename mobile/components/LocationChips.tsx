import React from 'react';
import { Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { SPACING } from '../config/brand';
import { radius } from '../theme/tokens';

interface LocationChipsProps {
  /** Featured cities to surface (already ordered for the user's country). */
  cities: string[];
  /** Currently selected city. Empty string = "All cities". */
  selectedCity: string;
  onSelectCity: (city: string) => void;
}

/**
 * Horizontal, location-first browsing rail. Picking a town is the quickest way
 * to find nearby events — so this sits at the top of Discover.
 */
export function LocationChips({ cities, selectedCity, onSelectCity }: LocationChipsProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const renderChip = (label: string, value: string, key: string) => {
    const isActive = selectedCity === value;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.chip, isActive && styles.chipActive]}
        onPress={() => onSelectCity(value)}
        activeOpacity={0.8}
      >
        <MapPin size={14} color={isActive ? colors.onPrimary : colors.primary} />
        <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {renderChip(t('discover.allCities'), '', '__all__')}
      {cities.map((c) => renderChip(c, c, c))}
    </ScrollView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: SPACING.lg,
      gap: SPACING.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.chip,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: 0.2,
    },
    chipTextActive: {
      color: colors.onPrimary,
    },
  });
