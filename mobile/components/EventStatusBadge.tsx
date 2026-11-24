import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ViewStyle,
} from 'react-native';
import { BADGE_COLORS, BadgeStatus } from '../theme/badges';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';
import { useReducedMotion } from '../lib/a11y';

/** Maps a display status to its BADGE_COLORS key (handles spaced labels). */
const STATUS_KEY: Record<BadgeStatus, keyof typeof BADGE_COLORS> = {
  VIP: 'vip',
  Trending: 'trending',
  New: 'new',
  Free: 'free',
  'Last Chance': 'lastChance',
  'Sold Out': 'soldOut',
};

/**
 * Single dot + label color per status. Gradient statuses (VIP/Trending/New)
 * collapse to a representative teal from their family; solid statuses reuse
 * their semantic `text` hue. The label always renders IN this color.
 */
const STATUS_COLOR: Record<BadgeStatus, string> = {
  VIP: '#2DD4BF',
  Trending: '#14B8A6',
  New: '#2DD4BF',
  Free: BADGE_COLORS.free.text,
  'Last Chance': BADGE_COLORS.lastChance.text,
  'Sold Out': BADGE_COLORS.soldOut.text,
};

export interface EventStatusBadgeProps {
  status: BadgeStatus;
  size?: 'small' | 'large';
  style?: ViewStyle;
}

/**
 * Status badge under the platform-wide de-pill: a 6px colored dot + an uppercase
 * label in the status color, inline, with NO filled pill background. VIP and
 * Trending keep their premium pulse animation.
 */
export default function EventStatusBadge({ status, size = 'small', style }: EventStatusBadgeProps) {
  const { t } = useI18n();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const reduced = useReducedMotion();

  useEffect(() => {
    // Premium pulse animation for VIP and Trending (still under Reduce Motion).
    if (reduced) {
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
      return;
    }
    if (status === 'VIP' || status === 'Trending') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.05,
              duration: 1500,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0.85,
              duration: 1500,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 1500,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 1500,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [status, scaleAnim, opacityAnim, reduced]);

  const color = STATUS_COLOR[status] ?? STATUS_COLOR.New;
  const fontSize = size === 'small' ? 10 : 12;
  const label = t(`badges.${String(status).toLowerCase().replace(/\s+/g, '')}`);
  const accessibilityLabel = `${label} ${t('badges.event')}`;

  const content = (
    <View style={styles.content}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { fontSize, color }]}>{label}</Text>
    </View>
  );

  const animated = status === 'VIP' || status === 'Trending';

  return (
    <Animated.View
      style={[
        styles.badge,
        animated && { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        style,
      ]}
      accessible={true}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
    >
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  label: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
