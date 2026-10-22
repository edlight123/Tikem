import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Dimensions, StyleSheet, ScrollView, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, MapPin } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import PaginationDots from './PaginationDots';
import { useI18n } from '../contexts/I18nContext';
import { resolvePosterTheme } from '../lib/posterGradient';
import { font } from '../theme/tokens';

import { formatDateForLanguage } from '../lib/dates';

interface Event {
  id: string;
  title: string;
  description: string;
  start_datetime: Date;
  banner_image_url?: string;
  venue_name: string;
  city: string;
  category: string;
  ticket_price?: number;
  currency?: string;
}

interface FeaturedCarouselProps {
  events: Event[];
  onEventPress: (eventId: string) => void;
}

const { width } = Dimensions.get('window');

export default function FeaturedCarousel({ events, onEventPress }: FeaturedCarouselProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (events.length <= 1) return;
    
    const interval = setInterval(() => {
      const nextIndex = (currentIndex + 1) % events.length;
      
      // Scroll to exact position accounting for card width and margins
      scrollViewRef.current?.scrollTo({
        x: nextIndex * width,
        animated: true,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [currentIndex, events.length]);

  if (!events || events.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        snapToInterval={width}
        snapToAlignment="center"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
      >
        {events.map((event) => {
          const theme = resolvePosterTheme(event, event.id || event.title, event.category);
          return (
          <TouchableOpacity
            key={event.id}
            style={styles.card}
            onPress={() => onEventPress(event.id)}
            activeOpacity={0.95}
          >
            {/* Full-bleed poster — image only, no scrim */}
            <View style={styles.poster}>
              {/* Fallback art only — behind a LOADING image this flashed the teal
                  gradient between skeleton and poster (same bug as PosterEventCard). */}
              {!event.banner_image_url && (
                <LinearGradient
                  colors={theme.colors}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              {event.banner_image_url && (
                <Image
                  source={{ uri: event.banner_image_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                  recyclingKey={event.id ? String(event.id) : undefined}
                />
              )}
            </View>

            {/* Title + meta sit BELOW the poster on the dark canvas (no background) */}
            <View style={styles.content}>
              <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
              <View style={styles.details}>
                <Calendar size={13} color={colors.textSecondary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {formatDateForLanguage(new Date(event.start_datetime), 'MMM d, yyyy', language)}
                </Text>
                <Text style={styles.separator}>·</Text>
                <MapPin size={13} color={colors.textSecondary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {event.venue_name}, {event.city}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Animated Pagination Dots */}
      <PaginationDots total={events.length} activeIndex={currentIndex} />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  card: {
    width: width - 32,
    marginHorizontal: 16,
    backgroundColor: 'transparent',
  },
  poster: {
    width: '100%',
    height: 420,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  content: {
    paddingTop: 10,
  },
  title: {
    fontFamily: font.serif,
    fontSize: 24,
    color: colors.text,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
    flexWrap: 'nowrap',
  },
  detailText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  separator: {
    color: colors.textTertiary,
    marginHorizontal: 3,
  },
});
