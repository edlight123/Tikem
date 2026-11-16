import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { displayCapacity } from '../lib/ticketPricing';

export interface TicketAvailabilityBarProps {
  totalTickets: number;
  ticketsSold: number;
  style?: any;
}

export default function TicketAvailabilityBar({
  totalTickets: rawTotal,
  ticketsSold,
  style,
}: TicketAvailabilityBarProps) {
  // Unlimited (sentinel) reads as "no info": the public never sees a capacity.
  const totalTickets = displayCapacity(rawTotal);
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const remainingTickets = Math.max(0, totalTickets - ticketsSold);
  const percentageSold = totalTickets > 0 ? (ticketsSold / totalTickets) * 100 : 0;
  const isSoldOut = remainingTickets === 0;
  const isAlmostSoldOut = !isSoldOut && remainingTickets < 10;

  // Don't show if no tickets info
  if (totalTickets === 0) return null;

  const getBarColor = () => {
    if (isSoldOut) return colors.error;
    if (isAlmostSoldOut) return colors.warning;
    if (percentageSold > 70) return colors.warning;
    return colors.success;
  };

  const getStatusText = () => {
    if (isSoldOut) return t('badges.soldout');
    if (isAlmostSoldOut) return `${t('ticketAvailabilityBar.only')} ${remainingTickets} ${t('ticketAvailabilityBar.left')}`;
    if (percentageSold > 70) return `${remainingTickets} ${t('ticketAvailabilityBar.ticketsRemaining')}`;
    return `${remainingTickets} ${t('ticketAvailabilityBar.available')}`;
  };

  return (
    <View style={[styles.container, style]}>
      {/* Progress Bar */}
      <View style={styles.barContainer}>
        <View style={styles.barBackground}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.min(percentageSold, 100)}%`,
                backgroundColor: getBarColor(),
              },
            ]}
          />
        </View>
      </View>

      {/* Status Text */}
      <View style={styles.textContainer}>
        <Text
          style={[
            styles.statusText,
            {
              color: getBarColor(),
              fontWeight: isAlmostSoldOut || isSoldOut ? '700' : '600',
            },
          ]}
        >
          {getStatusText()}
        </Text>
        <Text style={styles.soldText}>
          {ticketsSold.toLocaleString()} / {totalTickets.toLocaleString()} {t('common.sold')}
        </Text>
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  barContainer: {
    marginBottom: 6,
  },
  barBackground: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 4,
  },
  textContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  soldText: {
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.textSecondary,
  },
});
