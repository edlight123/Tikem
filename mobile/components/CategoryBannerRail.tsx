import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { getCategoryLabel } from '../lib/categories';
import { DISCOVER_CATEGORIES } from '../lib/categoryArt';
import { NO_ART_FILL, tileArtForCategory } from '../lib/artLibrary';
import { radius, withAlpha } from '../theme/tokens';

/**
 * "discover more" — posh-style category banners: a vertical stack of
 * full-width photo bands, each carrying the category name centered and an
 * editorial index number. Every category is always present (unlike the
 * per-category carousels, which only render when a category has events), so
 * browsing by vibe never depends on tonight's inventory.
 */
export default function CategoryBannerRail({
  onCategoryPress,
}: {
  onCategoryPress: (category: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  return (
    <View>
      <Text style={styles.title}>{t('home.discoverMoreTitle')}</Text>
      <Text style={styles.subtitle}>{t('home.discoverMoreSubtitle')}</Text>
      <View style={styles.stack}>
        {DISCOVER_CATEGORIES.map((cat, i) => {
          const art = tileArtForCategory(cat);
          return (
            <TouchableOpacity
              key={cat}
              style={styles.banner}
              activeOpacity={0.88}
              onPress={() => onCategoryPress(cat)}
              accessibilityRole="button"
              accessibilityLabel={getCategoryLabel(t, cat)}
            >
              {art ? (
                <>
                  <Image
                    source={art.source}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory"
                  />
                  {/* Even darkening, heavier at the bottom, so the centred
                      label reads on bright screenprint art. */}
                  <LinearGradient
                    colors={[withAlpha('#000000', 0.38), withAlpha('#000000', 0.5), withAlpha('#000000', 0.72)]}
                    style={StyleSheet.absoluteFill}
                  />
                </>
              ) : (
                // A world with no art yet: a dark neutral fill, not a photo
                // from another world.
                <LinearGradient colors={NO_ART_FILL} style={StyleSheet.absoluteFill} />
              )}
              <Text style={styles.index}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={styles.label} numberOfLines={1}>
                {getCategoryLabel(t, cat).toLowerCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    title: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 22,
      color: colors.text,
    },
    subtitle: {
      fontSize: 11,
      letterSpacing: 0.4,
      color: colors.textSecondary,
      marginTop: 3,
      marginBottom: 14,
    },
    stack: {
      gap: 10,
    },
    banner: {
      height: 76,
      borderRadius: radius.poster,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    label: {
      fontSize: 19,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.2,
    },
    // Editorial index ("01"), like posh's numbered bands.
    index: {
      position: 'absolute',
      left: 14,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1,
      color: 'rgba(255,255,255,0.75)',
    },
  });
