import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import WhitePillCTA from './WhitePillCTA';
import { radius } from '../theme/tokens';
import { nationalDayText, type ActiveNationalDay } from '../lib/nationalDays';
import { nationalDayArt } from '../lib/nationalDaysRemote';

interface Props {
  active: ActiveNationalDay;
  /** Omit to hide the pill (a low-key day with no tagged events). */
  onSeeEvents?: () => void;
  onDismiss: () => void;
}

/**
 * The national-day poster at the top of Home: the day's art full width, the
 * EmptyState poster treatment (bottom scrim, small uppercase place caption,
 * big title, one line), then one white pill to the tagged events.
 *
 * Status is a dot and a label ("Today", "In 3 days"), never a filled pill.
 * The dot is teal on the day itself; Flag Day swaps it for the flag's blue.
 */
export default function NationalDayBanner({ active, onSeeEvents, onDismiss }: Props) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const { width, height } = useWindowDimensions();
  const art = nationalDayArt(active.day);
  const { title, message } = nationalDayText(active.day, language);

  const posterWidth = width - 32;
  // 4:5 like the art, but never more than ~55% of the screen, so the first
  // rail still peeks in under it.
  const posterHeight = Math.min(posterWidth * 1.25, height * 0.55);

  const when =
    active.phase === 'today'
      ? t('home.nationalDay.today')
      : active.daysUntil === 1
        ? t('home.nationalDay.tomorrow')
        : t('home.nationalDay.inDays', { count: active.daysUntil });
  const dot = active.day.accent || (active.phase === 'today' ? colors.primary : 'rgba(255,255,255,0.55)');
  const strong = art?.scrim === 'strong';

  return (
    <View style={styles.wrap}>
      <View style={[styles.poster, { height: posterHeight, backgroundColor: colors.surface }]}>
        {art && (
          <Image
            source={art.source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            accessibilityLabel={art.alt}
          />
        )}
        <LinearGradient
          colors={
            strong
              ? ['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.96)']
              : ['rgba(10,10,10,0)', 'rgba(10,10,10,0.35)', 'rgba(10,10,10,0.92)']
          }
          locations={strong ? [0.25, 0.55, 1] : [0.35, 0.6, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={t('home.nationalDay.dismiss')}
        >
          <X size={16} color="#FFFFFF" strokeWidth={2.2} />
        </Pressable>
        <View style={styles.text}>
          <View style={styles.captionRow}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.caption} numberOfLines={1}>
              {when.toUpperCase()}
              {art?.place ? `  ·  ${art.place.toUpperCase()}` : ''}
            </Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {onSeeEvents && (
            <WhitePillCTA
              label={t('home.nationalDay.seeEvents')}
              onPress={onSeeEvents}
              compact
              style={styles.cta}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 28,
  },
  poster: {
    borderRadius: radius.poster,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    // A fill, so the X reads on any art.
    backgroundColor: 'rgba(10,10,10,0.55)',
  },
  text: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  caption: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.7)',
  },
  // Fixed white: the words sit on the dark scrim in every theme.
  title: {
    fontSize: 32,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.82)',
  },
  cta: {
    marginTop: 16,
    alignSelf: 'stretch',
  },
});
