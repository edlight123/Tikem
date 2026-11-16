import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useI18n } from '../contexts/I18nContext';
import { getCategoryLabel } from '../lib/categories';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';

export const CATEGORIES = [
  'Music',
  'Sports',
  'Arts & Culture',
  'Business',
  'Food & Drink',
  'Education',
  'Technology',
  'Health & Wellness',
  'Party',
  'Religious',
  'Other'
];

const CATEGORY_EMOJIS: Record<string, string> = {
  'Music': '🎵',
  'Sports': '🏆',
  'Arts & Culture': '🎨',
  'Business': '💼',
  'Food & Drink': '🍽️',
  'Education': '🎓',
  'Technology': '💻',
  'Health & Wellness': '💪',
  'Party': '🎉',
  'Religious': '⛪',
  'Other': '✨'
};

interface CategoryChipsProps {
  selectedCategories: string[];
  onCategoryToggle: (category: string) => void;
}


export function CategoryChips({ selectedCategories, onCategoryToggle }: CategoryChipsProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {CATEGORIES.map((category) => {
          const isActive = selectedCategories.includes(category);
          return (
            <TouchableOpacity
              key={category}
              style={[
                styles.chip,
                isActive && styles.chipActive
              ]}
              onPress={() => onCategoryToggle(category)}
              activeOpacity={0.7}
            >
              <Text style={styles.emoji}>{CATEGORY_EMOJIS[category]}</Text>
              <Text style={[
                styles.chipText,
                isActive && styles.chipTextActive
              ]}>
                {getCategoryLabel(t, category)}
              </Text>
            </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  emoji: {
    fontSize: 14,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
});
