import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Users } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { safeFormatForLanguage } from '../lib/dates';
import { resolvePosterTheme } from '../lib/posterGradient';
import { formatPrice } from '../lib/currency';
import { advertisedPrice } from '../lib/buyerPricing';
import { resolveEventPricing } from '../lib/ticketPricing';
import { font, radius } from '../theme/tokens';
import type { BadgeStatus } from '../theme/badges';

interface PosterEventCardProps {
  event: any;
  onPress: () => void;
  /** Fixed width (for horizontal rails). Omit to flex to the parent. */
  width?: number;
  /** Poster height / width ratio. 1.25 = 4:5 (default), 1.1 = wider hero. */
  ratio?: number;
  /** Override the auto-derived status badge. */
  badge?: BadgeStatus | null;
  /** Show the bottom meta strip (venue + date). Default true. */
  showMeta?: boolean;
  /** Optional "N friends going" social proof shown in the footer. */
  friendsGoing?: number;
  /** Optional node rendered over the poster's top-left (e.g. a quick action). */
  overlay?: React.ReactNode;
  /** Horizontal (and top) inset around the poster so it sits inside the card
   *  edges with visible gutters. Default 0 keeps the poster flush (Home/Favorites). */
  posterInsetX?: number;
  /** Viewer's city. When set, shows the venue alone for local events and appends
   *  the city only for out-of-town ones. */
  userCity?: string;
}

/**
 * The single, poster-led event card used across every discovery surface.
 * - Real banner when available; otherwise a deterministic teal poster gradient
 *   with the wrapped event TITLE rendered in serif (never a bare monogram or a
 *   grey placeholder) — the fallback poster IS the art (POSH §2.8).
 * - Three-tier caption below the poster (POSH §2.5): bold white title →
 *   grey price · venue → lighter-grey date. Teal is NOT used for the price;
 *   the accent stays reserved for semantic use (verified / live / links).
 */
export default function PosterEventCard({
  event,
  onPress,
  width,
  ratio = 1.25,
  badge,
  showMeta = true,
  friendsGoing = 0,
  overlay,
  posterInsetX = 0,
  userCity,
}: PosterEventCardProps) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = getStyles(colors);
  const scale = useRef(new Animated.Value(1)).current;

  const hasImage = Boolean(event.banner_image_url);
  const theme = resolvePosterTheme(event, event.id || event.title, event.category);

  // See EventListCard: `ticket_price` is the lowest tier price, so it cannot
  // decide freeness once free and paid tiers coexist on one event.
  const pricing = resolveEventPricing(event);
  const isFree = pricing.isFreeOnly;
  // ALL-IN: a buyer-pays market adds the fee at checkout, so the bare face
  // value would advertise a price nobody is charged. Haiti is unchanged.
  const price = advertisedPrice(
    pricing.lowestPaidPrice ?? Number(event.ticket_price || 0),
    event as any
  );

  // Date is guarded — an invalid/missing start_datetime yields '' rather than
  // crashing date-fns (POSH constraint: never crash on a bad date).
  const dateLabel = showMeta
    ? safeFormatForLanguage(event.start_datetime, 'EEE, MMM d', language)
    : '';

  // Venue-first place line: the venue is never redundant; the city only shows
  // when the event is out of the viewer's town.
  const venue = (event.venue_name || '').trim();
  const city = (event.city || '').trim();
  const place = !venue
    ? city
    : userCity && city && city !== userCity
    ? `${venue} · ${city}`
    : venue;

  // Tier 2 — grey price · venue.
  const priceLabel = isFree ? t('common.free') : formatPrice(price, event.currency);
  const tier2Line = [priceLabel, showMeta ? place : ''].filter(Boolean).join('  ·  ');

  const friendsLabel =
    friendsGoing > 0
      ? `${friendsGoing} ${t(friendsGoing === 1 ? 'social.friendGoingSuffix' : 'social.friendsGoingSuffix')}`
      : '';

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 50, useNativeDriver: true }).start();

  return (
    <Animated.View style={[{ transform: [{ scale }] }, width ? { width } : { flex: 1 }]}>
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={styles.card}
      >
        <View style={{ paddingHorizontal: posterInsetX, paddingTop: posterInsetX }}>
          <View style={[styles.poster, { aspectRatio: 1 / ratio }]}>
            {/* The teal theme gradient is the PERMANENT art for events with no
                poster — not a loading state. It used to sit behind every image
                while it fetched, so each card flashed green between skeleton
                and poster. With an image, the backdrop is now the neutral
                surface the skeleton just showed, so loading reads as
                grey -> poster with no colour step. */}
            {!hasImage && (
              <LinearGradient
                colors={theme.colors}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}

            {hasImage ? (
              // expo-image: disk+memory cached so posters don't re-download on
              // every scroll/render (the RN Image before this had no cache).
              // recyclingKey keeps the right image on recycled rows; the built-in
              // transition fades it in over the gradient fallback.
              <Image
                source={{ uri: event.banner_image_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
                recyclingKey={event.id ? String(event.id) : undefined}
              />
            ) : (
              // Fallback poster: the wrapped event title becomes the artwork.
              <View style={styles.fallbackWrap}>
                <Text style={styles.fallbackTitle} numberOfLines={4}>
                  {event.title || '?'}
                </Text>
              </View>
            )}

            {overlay ? <View style={styles.overlayWrap}>{overlay}</View> : null}
          </View>
        </View>

        {/* Three-tier caption (POSH §2.5). All text sits BELOW the poster so it
            never covers the artwork. */}
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            {event.title}
          </Text>

          {!!tier2Line && (
            <Text style={styles.tier2} numberOfLines={1}>
              {tier2Line}
            </Text>
          )}

          {!!dateLabel && (
            <Text style={styles.tier3} numberOfLines={1}>
              {dateLabel}
            </Text>
          )}

          {!!friendsLabel && (
            <View style={styles.friendsRow}>
              <Users size={11} color={colors.textSecondary} />
              <Text style={styles.friendsText} numberOfLines={1}>
                {friendsLabel}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    // Posh-style: no card fill, border, or shadow — the poster sits directly
    // on the page and the text sits beneath it on the dark canvas.
    card: {
      backgroundColor: 'transparent',
    },
    poster: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      // A whisper of rounding on artwork — near-posh-sharp, but not a razor
      // edge (owner iterated: fully square felt too hard on device).
      borderRadius: radius.poster,
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
    },
    fallbackWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    fallbackTitle: {
      fontFamily: font.serif,
      fontSize: 26,
      lineHeight: 28,
      textAlign: 'center',
      color: 'rgba(255,255,255,0.94)',
      letterSpacing: -0.3,
    },
    overlayWrap: {
      position: 'absolute',
      top: 10,
      left: 10,
    },
    content: {
      paddingTop: 8,
      gap: 3,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 16,
      color: colors.text,
      lineHeight: 18,
      letterSpacing: -0.2,
    },
    // Tier 2 — grey price · venue.
    tier2: {
      color: colors.textSecondary,
      fontSize: 11.5,
      // Explicit line heights keep the caption block's height fixed, so the
      // grid's row gap is measured from where the text really ends.
      lineHeight: 15,
      letterSpacing: 0.3,
      marginTop: 1,
    },
    // Tier 3 — lighter grey date.
    tier3: {
      color: colors.textTertiary,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.4,
    },
    friendsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    friendsText: {
      color: colors.textSecondary,
      fontSize: 10.5,
      letterSpacing: 0.3,
      flexShrink: 1,
    },
  });
