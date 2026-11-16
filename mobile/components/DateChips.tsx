import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Touchable } from './ui/Touchable';

import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';

// 'pick-date' is selectable from WhenPickerSheet's calendar, not from these
// chips — the union widens so sheet and chips share one type.
export type DateFilter = 'any' | 'today' | 'tomorrow' | 'this-week' | 'this-weekend' | 'pick-date';

interface DateChipsProps {
  currentDate: DateFilter;
  onDateChange: (date: DateFilter) => void;
}

const DATE_OPTIONS: { value: DateFilter; labelKey: string }[] = [
  { value: 'any', labelKey: 'filters.dateOptions.any' },
  { value: 'today', labelKey: 'filters.dateOptions.today' },
  { value: 'tomorrow', labelKey: 'filters.dateOptions.tomorrow' },
  { value: 'this-week', labelKey: 'filters.dateOptions.thisWeek' },
  { value: 'this-weekend', labelKey: 'filters.dateOptions.thisWeekend' },
];

export function DateChips({ currentDate, onDateChange }: DateChipsProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {DATE_OPTIONS.map((option) => {
          const isActive = currentDate === option.value;
          return (
            <Touchable
              key={option.value}
              style={[
                styles.chip,
                isActive && styles.chipActive
              ]}
              onPress={() => onDateChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[
                styles.chipText,
                isActive && styles.chipTextActive
              ]}>
                {t(option.labelKey)}
              </Text>
            </Touchable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.chip,
    // A fill, not a hairline box; selected = the white pill (same as FilterPill).
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: {
    backgroundColor: colors.white,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#000000',
  },
});
