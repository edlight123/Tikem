import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getOrganizerEvents, OrganizerEvent } from '../../lib/api/organizer';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { RADIUS } from '../../config/brand';
import { font, radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusChip from '../../components/StatusChip';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { TikemWordmark } from '../../components/TikemWordmark';

type EventStatus = 'draft' | 'unpublished' | 'sold_out' | 'rejected' | 'cancelled';

export default function OrganizerEventsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<NavigationProp>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [eventTab, setEventTab] = useState<'upcoming' | 'past'>('upcoming');
  const [allEvents, setAllEvents] = useState<OrganizerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!userProfile?.id) return;

    try {
      const eventsData = await getOrganizerEvents(userProfile.id, 100);
      setAllEvents(eventsData);
    } catch (error) {
      console.error('Error loading organizer events:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Reload events when screen comes into focus (e.g., after editing)
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvents();
  }, [loadEvents]);

  const now = new Date();

  const upcomingEvents = allEvents.filter((e) => {
    const cutoff = (e as any).end_datetime || e.start_datetime;
    if (!cutoff) return false;
    return new Date(cutoff) > now;
  });

  const pastEvents = allEvents.filter((e) => {
    const cutoff = (e as any).end_datetime || e.start_datetime;
    if (!cutoff) return false;
    return new Date(cutoff) <= now;
  });

  const events = eventTab === 'upcoming' ? upcomingEvents : pastEvents;

  const createButton = (
    <TouchableOpacity
      style={styles.createButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => navigation.navigate('CreateEvent')}
    >
      <Ionicons name="add" size={18} color={colors.text} />
      <Text style={styles.createButtonText}>{t('organizerEvents.create')}</Text>
    </TouchableOpacity>
  );

  // Only the exceptions earn a label. A live event (and a past one that
  // simply finished) is the normal state, so it returns null and the row
  // carries no status at all — "PUBLISHED" on every row was pure noise.
  const getDisplayStatus = (event: OrganizerEvent): EventStatus | null => {
    if ((event as any).rejected === true) return 'rejected';
    if (event.status === 'cancelled') return 'cancelled';
    if (!event.is_published) return event.status === 'draft' ? 'draft' : 'unpublished';
    // `total_tickets > 0` guard: an event with no capacity set used to read
    // as sold out because 0 >= 0.
    if (event.total_tickets > 0 && (event.tickets_sold || 0) >= event.total_tickets) return 'sold_out';
    return null;
  };

  // Map an event status to the locked StatusChip semantic (POSH §2.7):
  //   draft/unpublished → action-needed (amber) · sold out/rejected/cancelled → red.
  const getChipStatus = (status: EventStatus): string => {
    switch (status) {
      case 'draft':
      case 'unpublished':
        return 'actionNeeded';
      case 'sold_out':
        return 'soldOut';
      case 'rejected':
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: EventStatus) => {
    switch (status) {
      case 'draft':
        return t('organizerEvents.status.draft');
      case 'unpublished':
        return t('organizerEvents.status.unpublished');
      case 'sold_out':
        return t('organizerEvents.status.soldOut');
      case 'rejected':
        return t('organizerEvents.status.rejected');
      case 'cancelled':
        return t('organizerEvents.status.cancelled');
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('organizerEvents.title')}
          right={createButton}
          overlay
          onHeight={onHeight}
        />
        {/* Mirrors the segmented control row (pill ≈ 35 tall: paddingVertical
            9×2 + 17 text) that reserves the header height when loaded. */}
        <View style={[styles.segmentedWrap, { marginTop: headerH }]}>
          <View style={styles.segmentedSkeletonRow}>
            <Skeleton width={110} height={35} radius={999} />
            <Skeleton width={90} height={35} radius={999} />
          </View>
        </View>
        {/* Event cards: 104-wide 4:5 poster thumb + title/meta/footer column. */}
        <View style={styles.skeletonList}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.eventCard}>
              <Skeleton width={104} aspectRatio={4 / 5} radius={radius.chip} />
              <View style={styles.skeletonCardBody}>
                <View>
                  <Skeleton width="72%" height={20} radius={7} />
                  <Skeleton width="60%" height={14} radius={5} style={{ marginTop: 8 }} />
                  <Skeleton width="40%" height={12} radius={5} style={{ marginTop: 6 }} />
                </View>
                <View>
                  <Skeleton width={80} height={12} radius={5} />
                  <Skeleton width="100%" height={3} radius={2} style={{ marginTop: 6 }} />
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <OrganizerScreenHeader
        title={t('organizerEvents.title')}
        right={createButton}
        overlay
        onHeight={onHeight}
      />

      {/* Segmented Control — static, so it reserves the floating header's
          measured height on behalf of the list below. */}
      <View style={[styles.segmentedWrap, { marginTop: headerH }]}>
        <SegmentedTabs
          value={eventTab}
          onChange={(key) => setEventTab(key as 'upcoming' | 'past')}
          tabs={[
            { key: 'upcoming', label: t('organizerEvents.upcoming'), count: upcomingEvents.length },
            { key: 'past', label: t('organizerEvents.past'), count: pastEvents.length },
          ]}
        />
      </View>

      {/* Events List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: tabBarSpace + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {events.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={eventTab === 'upcoming' ? t('organizerEvents.emptyUpcomingTitle') : t('organizerEvents.emptyPastTitle')}
            subtitle={eventTab === 'upcoming'
              ? t('organizerEvents.emptyUpcomingBody')
              : t('organizerEvents.emptyPastBody')}
            actionLabel={eventTab === 'upcoming' ? t('organizerDashboard.createEventCta') : undefined}
            onAction={eventTab === 'upcoming' ? () => navigation.navigate('CreateEvent') : undefined}
          />
        ) : (
          events.map((event) => {
            const eventDate = new Date(event.start_datetime);
            const hasDate = !Number.isNaN(eventDate.getTime());
            // One compact line — "Sat, Sep 27 · 4:00 PM". The year only
            // appears when it isn't this one (mostly the Past tab).
            const dateLabel = hasDate
              ? `${eventDate.toLocaleDateString(locale, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  ...(eventDate.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
                })} · ${eventDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`
              : '';

            const displayStatus = getDisplayStatus(event);
            const statusLabel = displayStatus ? getStatusLabel(displayStatus) : null;
            const payoutBlocked = Boolean((event as any).payout_blocked);

            // Attendee-side reads banner first, then cover. Match that so the
            // real poster shows on the organizer list too.
            const posterUri = event.banner_image_url || event.cover_image_url;

            // Venue NAME only — the full street address truncated mid-word on
            // every row. Falls back to the first segment of the free-text
            // location ("Le Gibus, Paris, 18 Rue…" → "Le Gibus"), then city.
            const venueLabel =
              (event.venue_name && event.venue_name.trim()) ||
              (event.location && event.location.split(',')[0].trim()) ||
              (event.city && String(event.city).trim()) ||
              (event.commune && event.commune.trim()) ||
              '';

            const sold = event.tickets_sold || 0;
            const capacity = event.total_tickets || 0;
            const soldRatio = capacity > 0 ? Math.min(1, sold / capacity) : 0;
            const salesLabel = capacity > 0
              ? `${sold} / ${capacity} ${t('common.sold')}`
              : `${sold} ${t('common.sold')}`;

            return (
              <TouchableOpacity
                key={event.id}
                style={styles.eventCard}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={[
                  event.title,
                  dateLabel,
                  venueLabel,
                  statusLabel,
                  payoutBlocked ? t('organizerEvents.status.payoutBlocked') : null,
                  salesLabel,
                ].filter(Boolean).join(', ')}
                accessibilityHint={t('organizerEvents.manage')}
                onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id, event })}
              >
                {/* Vertical poster thumbnail on the left. Real image when we have
                    one; otherwise the poster gradient with a small centered
                    wordmark (branded-strip treatment adapted to a portrait thumb). */}
                <View style={styles.eventThumb}>
                  {/* Fallback art only. The old comment claimed cached posters
                      never flash — true for cached, false on first load, where
                      the teal gradient showed until the image arrived. */}
                  {!posterUri && (
                    <LinearGradient
                      colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  )}
                  {posterUri ? (
                    <Image
                      source={{ uri: posterUri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={200}
                      recyclingKey={event.id ? String(event.id) : undefined}
                    />
                  ) : (
                    <View style={styles.eventThumbBrand}>
                      <TikemWordmark fontSize={16} />
                    </View>
                  )}
                </View>
                {/* Three quiet tiers and no icons: title, when/where, sales.
                    A status appears only when it's NOT the normal state. */}
                <View style={styles.eventContent}>
                  <View>
                    {(statusLabel || payoutBlocked) && (
                      <View style={styles.statusRow}>
                        {displayStatus && statusLabel ? (
                          <StatusChip status={getChipStatus(displayStatus)} label={statusLabel} />
                        ) : null}
                        {/* A live event whose payout account can no longer
                            accept a charge (set by the Connect health sweep).
                            Buyers would fail at checkout, so it always shows. */}
                        {payoutBlocked ? (
                          <StatusChip status="error" label={t('organizerEvents.status.payoutBlocked')} />
                        ) : null}
                      </View>
                    )}
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    {dateLabel ? (
                      <Text style={styles.metaPrimary} numberOfLines={1}>
                        {dateLabel}
                      </Text>
                    ) : null}
                    {venueLabel ? (
                      <Text style={styles.metaSecondary} numberOfLines={1}>
                        {venueLabel}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.salesBlock}>
                    <Text style={styles.salesText}>{salesLabel}</Text>
                    {capacity > 0 ? (
                      <View style={styles.salesTrack}>
                        <View style={[styles.salesFill, { width: `${soldRatio * 100}%` }]} />
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Matches the loaded list: gutter 16, first card flush under the tabs row.
  skeletonList: {
    paddingHorizontal: 16,
  },
  // SegmentedTabs container row (gap 8, gutter 16, paddingVertical 4).
  segmentedSkeletonRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  // Mirrors eventContent: text stack on top, sales line + track at the foot.
  skeletonCardBody: {
    flex: 1,
    paddingVertical: 2,
    justifyContent: 'space-between',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.button,
  },
  createButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 4,
  },
  segmentedWrap: {
    paddingVertical: 12,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  // No card background (POSH poster-forward): the poster + text sit directly on
  // the canvas, so the artwork carries the card, not a grey container.
  eventCard: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
  },
  // Vertical poster thumbnail on the left (portrait ~4:5). Rounded here since
  // the card no longer clips it.
  eventThumb: {
    width: 104,
    aspectRatio: 4 / 5,
    // ~10% max roundness per beta feedback (104px * 0.10 ≈ 10).
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  eventThumbBrand: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    paddingHorizontal: 8,
  },
  eventContent: {
    flex: 1,
    paddingVertical: 2,
    justifyContent: 'space-between',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 6,
  },
  eventTitle: {
    fontFamily: font.serif,
    fontSize: 20,
    color: colors.text,
    lineHeight: 24,
  },
  // Date/time is the one fact an organizer scans for, so it gets the brighter
  // tier; the venue sits one step quieter beneath it.
  metaPrimary: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginTop: 6,
  },
  metaSecondary: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Sales sit at the foot of the poster as one quiet line over a slim filled
  // track — no ticket icon, no divider, no separate "Manage" link (the whole
  // row is the tap target).
  salesBlock: {
    marginTop: 10,
  },
  salesText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  salesTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    marginTop: 6,
    overflow: 'hidden',
  },
  salesFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});
