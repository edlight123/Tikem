import React from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { useI18n } from '../contexts/I18nContext';
import PosterEventCard from './PosterEventCard';
import SectionHeader from './SectionHeader';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min(248, width * 0.62);
const CARD_SPACING = 16;

interface TrendingSectionProps {
  events: any[];
  onEventPress: (eventId: string) => void;
  onViewAll: () => void;
}

export default function TrendingSection({ events, onEventPress, onViewAll }: TrendingSectionProps) {
  const { t } = useI18n();
  if (events.length === 0) return null;

  return (
    <View>
      <SectionHeader
        title={t('home.trendingTitle')}
        onViewAll={onViewAll}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        snapToInterval={CARD_WIDTH + CARD_SPACING}
        decelerationRate="fast"
      >
        {events.map((event) => (
          <PosterEventCard
            key={event.id}
            event={event}
            width={CARD_WIDTH}
            badge="Trending"
            onPress={() => onEventPress(event.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginHorizontal: -16,
  },
  content: {
    paddingHorizontal: 16,
    gap: CARD_SPACING,
  },
});
