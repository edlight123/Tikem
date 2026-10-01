import React from 'react';
import { Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { getCategoryLabel } from '../lib/categories';
import { NO_ART_FILL, tileArtForCategory } from '../lib/artLibrary';
import { SPACING } from '../config/brand';
import { radius } from '../theme/tokens';

interface CategoryRailProps {
  onCategoryPress: (category: string) => void;
}

// Slim browsing chips. Events stay the stars of the feed (Posh-style);
// categories are a quick secondary way to jump into Discover. Each chip wears
// a sliver of its world's art under a heavy scrim (or a dark neutral fill when
// the world has none), instead of an emoji.
const CATEGORIES = [
  'Music',
  'Party',
  'Sports',
  'Arts & Culture',
  'Food & Drink',
  'Business',
  'Technology',
  'Education',
  'Health & Wellness',
  'Religious',
];

export default function CategoryRail({ onCategoryPress }: CategoryRailProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {CATEGORIES.map((name) => {
        const art = tileArtForCategory(name);
        return (
          <TouchableOpacity
            key={name}
            style={styles.pill}
            activeOpacity={0.85}
            onPress={() => onCategoryPress(name)}
            accessibilityRole="button"
          >
            {art ? (
              <>
                <Image source={art.source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" />
                <LinearGradient
                  colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.72)']}
                  style={StyleSheet.absoluteFill}
                />
              </>
            ) : (
              <LinearGradient colors={NO_ART_FILL} style={StyleSheet.absoluteFill} />
            )}
            <Text style={styles.label}>{getCategoryLabel(t, name).toLowerCase()}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: SPACING.lg,
      gap: SPACING.sm,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.chip,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    label: {
      fontSize: 14,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.2,
    },
  });
