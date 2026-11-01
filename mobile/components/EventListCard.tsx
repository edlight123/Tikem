import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, MapPin } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { resolvePosterTheme } from '../lib/posterGradient';
import { safeFormatForLanguage } from '../lib/dates';
import { formatPrice } from '../lib/currency';
import { advertisedPrice } from '../lib/buyerPricing';
import { resolveEventPricing } from '../lib/ticketPricing';
import { font, radius } from '../theme/tokens';

interface EventListCardProps {
  event: any;
  onPress: () => void;
}

/**
 * A horizontal list card: portrait 4:5 poster on the left, event details
 * (title, date, venue, price) on the right. Mirrors PosterEventCard's poster
 * fallback (deterministic teal gradient) and formatting conventions.
 */
export default function EventListCard({ event, onPress }: EventListCardProps) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = getStyles(colors);

  const theme = resolvePosterTheme(event, event.id || event.title, event.category);

  // `ticket_price` is the LOWEST tier price, so it is 0 for any event carrying a
  // free tier — including one that also sells paid tiers. Such an event must not
  // be labelled "FREE"; show its cheapest PAID price instead.
  const pricing = resolveEventPricing(event);
  const isFree = pricing.isFreeOnly;
  // ALL-IN: in a buyer-pays market the fee is added at checkout, so advertising
  // the bare face value here would quote a price nobody is charged. Haiti absorbs
  // the fee, so this is the face value unchanged.
  const price = advertisedPrice(
    pricing.lowestPaidPrice ?? Number(event.ticket_price || 0),
    event as any
  );

  // Guarded — an invalid/missing date yields '' instead of crashing date-fns.
  const dateLabel = safeFormatForLanguage(event.start_datetime, 'EEE, MMM d · h:mm a', language);
  const location = [event.venue_name, event.city].filter(Boolean).join(', ');

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.card}>
      {/* LEFT: portrait poster with deterministic gradient fallback. */}
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
        {event.banner_image_url ? (
          <Image
            source={{ uri: event.banner_image_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            recyclingKey={event.id ? String(event.id) : undefined}
          />
        ) : null}
      </View>

      {/* RIGHT: event details. */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>

        {dateLabel ? (
          <View style={styles.metaRow}>
            <Calendar size={13} color={colors.textSecondary} />
            <Text style={styles.metaText} numberOfLines={1}>
              {dateLabel}
            </Text>
          </View>
        ) : null}

        {location ? (
          <View style={styles.metaRow}>
            <MapPin size={13} color={colors.textSecondary} />
            <Text style={styles.metaText} numberOfLines={1}>
              {location}
            </Text>
          </View>
        ) : null}

        <View style={styles.priceWrap}>
          {isFree ? (
            <Text style={styles.priceFree}>{t('common.free').toUpperCase()}</Text>
          ) : (
            <Text style={styles.price}>
              {formatPrice(price, event.currency)}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      paddingVertical: 10,
      marginBottom: 4,
      gap: 12,
      alignItems: 'center',
    },
    poster: {
      width: 92,
      aspectRatio: 4 / 5,
      // Rounded per POSH §2.1 — proportional to this smaller thumbnail.
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
    },
    body: {
      flex: 1,
      justifyContent: 'center',
      gap: 6,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 18,
      color: colors.text,
      lineHeight: 21,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    metaText: {
      fontSize: 13,
      color: colors.textSecondary,
      letterSpacing: 0.3,
      flexShrink: 1,
    },
    priceWrap: {
      marginTop: 2,
    },
    // Price is grey, not teal — teal stays reserved for semantic use (POSH §1).
    priceFree: {
      color: colors.textSecondary,
      fontSize: 13,
      letterSpacing: 0.8,
    },
    price: {
      color: colors.textSecondary,
      fontSize: 13,
      letterSpacing: 0.3,
    },
  });
