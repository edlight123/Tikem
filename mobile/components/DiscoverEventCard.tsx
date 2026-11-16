import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Touchable } from './ui/Touchable';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Share2, Bookmark } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { safeFormatForLanguage } from '../lib/dates';
import { resolvePosterTheme } from '../lib/posterGradient';
import { formatPrice } from '../lib/currency';
import { advertisedPrice } from '../lib/buyerPricing';
import { resolveEventPricing } from '../lib/ticketPricing';
import { radius, font } from '../theme/tokens';
import WhitePillCTA from './WhitePillCTA';
import VerifiedBadge from './VerifiedBadge';


interface DiscoverEventCardProps {
  event: any;
  onPress: () => void;
  onShare?: () => void;
  onToggleSave?: () => void;
  saved?: boolean;
}

/**
 * Large, Posh-style Discover feed card: full-bleed poster, then title,
 * organizer, date/venue, share + save, and a white "Get Tickets" CTA.
 */
export default function DiscoverEventCard({
  event,
  onPress,
  onShare,
  onToggleSave,
  saved,
}: DiscoverEventCardProps) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = getStyles(colors);

  const theme = resolvePosterTheme(event, event.id || event.title, event.category);
  const hasImage = Boolean(event.banner_image_url || event.cover_image_url);
  // Show the WHOLE poster: size the card to the image's real aspect ratio so
  // nothing is cropped. Falls back to 2:3 until the image reports its size, and
  // is clamped so an extreme ratio can't blow up or collapse the card.
  const [aspectRatio, setAspectRatio] = useState<number>(2 / 3);
  // See EventListCard: `ticket_price` is the lowest tier price, so it cannot
  // decide freeness once free and paid tiers coexist on one event. A mixed event
  // gets the paid CTA — the buyer picks the free tier on the detail screen.
  const pricing = resolveEventPricing(event);
  const isFree = pricing.isFreeOnly;
  // ALL-IN: a buyer-pays market adds the fee at checkout, so the bare face
  // value would advertise a price nobody is charged. Haiti is unchanged.
  const price = advertisedPrice(
    pricing.lowestPaidPrice ?? Number(event.ticket_price || 0),
    event as any
  );
  // Prefer the organization brand name; the denormalized `organizer_name` on
  // the event doc is stamped with org-name-or-full-name at create/publish.
  const organizer = event.users?.organization_name || event.users?.full_name || event.organizer_name || '';

  // Guarded — an invalid/missing date yields '' instead of crashing date-fns.
  const dateLabel = safeFormatForLanguage(event.start_datetime, 'EEE, MMM d · h:mm a', language);
  const venue = [event.venue_name, event.city].filter(Boolean).join(', ');

  return (
    <View style={styles.wrap}>
      {/* Poster */}
      <Touchable scale={0.98} onPress={onPress} style={[styles.poster, { aspectRatio }]}>
        {/* Fallback art only — behind a LOADING image this flashed the teal
            gradient between skeleton and poster (same bug as PosterEventCard). */}
        {!hasImage && (
          <LinearGradient
            colors={theme.colors}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {hasImage && (
          <Image
            source={{ uri: event.banner_image_url || event.cover_image_url }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={200}
            recyclingKey={event.id ? String(event.id) : undefined}
            onLoad={(e) => {
              const w = e?.source?.width;
              const h = e?.source?.height;
              if (w && h) {
                // Clamp: never wider than 3:2, never taller than 2:3.5.
                setAspectRatio(Math.max(0.57, Math.min(1.5, w / h)));
              }
            }}
          />
        )}
      </Touchable>

      {/* Title + organizer + meta, with share/save on the right */}
      <View style={styles.body}>
        <View style={styles.bodyText}>
          <Touchable scale={false} haptic={false} onPress={onPress}>
            <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
          </Touchable>
          {!!organizer && (
            <View style={styles.orgRow}>
              <Text style={styles.org} numberOfLines={1}>{organizer}</Text>
              {event.users?.is_verified && <VerifiedBadge size="medium" />}
            </View>
          )}
          {(dateLabel || venue) && (
            <Text style={styles.meta} numberOfLines={2}>
              {[dateLabel, venue].filter(Boolean).join(` ${t('common.at')} `)}
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          <Touchable onPress={onShare} hitSlop={8} style={styles.actionBtn}>
            <Share2 size={20} color={colors.textSecondary} />
          </Touchable>
          <Touchable onPress={onToggleSave} hitSlop={8} style={styles.actionBtn}>
            <Bookmark size={20} color={saved ? colors.primary : colors.textSecondary} fill={saved ? colors.primary : 'transparent'} />
          </Touchable>
        </View>
      </View>

      {/* Adaptive white-pill CTA: RSVP for free, Get Tickets + price for paid. */}
      {isFree ? (
        <WhitePillCTA
          variant="rsvp"
          label={t('common.rsvp')}
          onPress={onPress}
          compact
          style={styles.cta}
        />
      ) : (
        <WhitePillCTA
          variant="paid"
          label={t('home.getTickets')}
          subLabel={`${t('common.from')} ${formatPrice(price, event.currency)}`}
          onPress={onPress}
          compact
          style={styles.cta}
        />
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    wrap: {
      marginBottom: 32,
    },
    poster: {
      width: '100%',
      // Height comes from the image's real aspect ratio (set at runtime) so the
      // full poster always shows, uncropped.
      borderRadius: radius.poster, // near-sharp poster edge (see tokens.ts)
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
    },
    body: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginTop: 12,
      gap: 12,
    },
    bodyText: {
      flex: 1,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 28,
      color: colors.text,
      letterSpacing: -0.3,
      lineHeight: 30,
    },
    orgRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    org: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    meta: {
      fontSize: 12,
      letterSpacing: 0.3,
      color: colors.textSecondary,
      marginTop: 4,
      lineHeight: 18,
    },
    actions: {
      flexDirection: 'row',
      gap: 16,
      paddingTop: 4,
    },
    actionBtn: {
      padding: 2,
    },
    cta: {
      marginTop: 16,
    },
  });
