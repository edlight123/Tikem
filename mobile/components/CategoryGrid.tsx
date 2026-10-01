import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { getCategoryLabel } from '../lib/categories';
import { NO_ART_FILL, tileArtForCategory } from '../lib/artLibrary';
import { RADIUS } from '../config/brand';

const { width } = Dimensions.get('window');
const GRID_COLUMNS = 2;
const CARD_SPACING = 12;
const CARD_WIDTH = (width - 32 - CARD_SPACING * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

interface CategoryGridProps {
  onCategoryPress: (category: string) => void;
}

// `name` is the database value. The background is the category's world art
// from lib/artLibrary (bundled, so the grid renders offline), or a dark
// neutral fill when that world has no art yet.
const categories = [
  'Music',
  'Sports',
  'Food & Drink',
  'Business',
  'Arts & Culture',
  'Party',
  'Religious',
  'Education',
];

const CategoryCard = ({
  category,
  onPress,
  styles,
}: {
  category: string;
  onPress: () => void;
  styles: ReturnType<typeof getStyles>;
}) => {
  const { t } = useI18n();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const art = tileArtForCategory(category);

  const handlePressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  const handlePressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={getCategoryLabel(t, category)}
      >
        {art ? (
          <>
            <Image source={art.source} style={styles.image} contentFit="cover" cachePolicy="memory" />
            {/* Bottom-weighted scrim: bright art up top, the label on dark. */}
            <LinearGradient
              colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.78)']}
              style={styles.overlay}
            />
          </>
        ) : (
          <LinearGradient colors={NO_ART_FILL} style={styles.overlay} />
        )}
        <View style={styles.textContainer}>
          <Text style={styles.categoryText}>{getCategoryLabel(t, category).toLowerCase()}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

export default function CategoryGrid({ onCategoryPress }: CategoryGridProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View style={styles.grid}>
      {categories.map((category) => (
        <CategoryCard
          key={category}
          category={category}
          styles={styles}
          onPress={() => onCategoryPress(category)}
        />
      ))}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: CARD_SPACING,
    },
    card: {
      width: CARD_WIDTH,
      height: 64,
      borderRadius: RADIUS.lg,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: colors.surfaceMuted,
    },
    image: {
      width: '100%',
      height: '100%',
      position: 'absolute',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
    },
    textContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    categoryText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: 0.2,
      textShadowColor: 'rgba(0, 0, 0, 0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
  });
