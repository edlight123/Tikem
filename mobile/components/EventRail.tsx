import React from 'react';
import { View, StyleSheet, ScrollView, Dimensions } from 'react-native';
import PosterEventCard from './PosterEventCard';
import SectionHeader from './SectionHeader';
import type { BadgeStatus } from '../theme/badges';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min(248, width * 0.62);
const CARD_SPACING = 16;
/** Card width and gap, for callers drawing a skeleton row of the same rail. */
export const RAIL_CARD_WIDTH = CARD_WIDTH;
export const RAIL_CARD_SPACING = CARD_SPACING;

interface EventRailProps {
  title: string;
  subtitle?: string;
  events: any[];
  onEventPress: (eventId: string) => void;
  onViewAll?: () => void;
  /** Optional badge override applied to every card in the rail. */
  badge?: BadgeStatus | null;
  /** The viewer's city, so cards add the city only for out-of-town events. */
  userCity?: string;
}

/**
 * Generic horizontal, snapping rail of poster cards with an editorial header.
 * Reused by every home/discover section so the feed stays consistent.
 */
export default function EventRail({
  title,
  subtitle,
  events,
  onEventPress,
  onViewAll,
  badge,
  userCity,
}: EventRailProps) {
  if (!events || events.length === 0) return null;

  return (
    <View>
      <SectionHeader title={title} subtitle={subtitle} onViewAll={onViewAll} />
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
            badge={badge}
            userCity={userCity}
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
