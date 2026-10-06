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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { artByKey } from '../../lib/artLibrary';
import StatusChip from '../../components/StatusChip';
import { TikemWordmark } from '../../components/TikemWordmark';

type EventStatus =
  | 'on_sale'
  | 'completed'
  | 'draft'
  | 'unpublished'
  | 'sold_out'
  | 'rejected'
  | 'cancelled';

// Card geometry, shared by the loaded rows and the skeleton so nothing jumps
// when data lands.
const THUMB_WIDTH = 92;

export default function OrganizerEventsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<NavigationProp>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
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

  const getDisplayStatus = (event: OrganizerEvent, isPast: boolean): EventStatus => {
    if ((event as any).rejected === true) return 'rejected';
    if (event.status === 'cancelled') return 'cancelled';
    if (!event.is_published) return event.status === 'draft' ? 'draft' : 'unpublished';
    // `total_tickets > 0` guard: an event with no capacity set used to read
    // as sold out because 0 >= 0.
    if (event.total_tickets > 0 && (event.tickets_sold || 0) >= event.total_tickets) return 'sold_out';
    return isPast ? 'completed' : 'on_sale';
  };

  // Map an event status to the locked StatusChip semantic (POSH §2.7):
  //   on sale → teal · draft/unpublished/completed → grey ·
  //   sold out/rejected/cancelled → red. Payout blocked is amber (below).
  const getChipStatus = (status: EventStatus): string => {
    switch (status) {
      case 'on_sale':
        return 'live';
      case 'sold_out':
        return 'soldOut';
      case 'rejected':
      case 'cancelled':
        return 'error';
      case 'draft':
      case 'unpublished':
      case 'completed':
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: EventStatus) => {
    switch (status) {
      case 'on_sale':
        return t('organizerEvents.status.onSale');
      case 'completed':
        return t('organizerEvents.status.completed');
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

  // Big left-aligned sans title + a small filled square "+" (radius 12). The
  // segmented control sits right under it, so the whole block stays put while
  // the list scrolls.
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {t('organizerEvents.title')}
        </Text>
        <TouchableOpacity
          style={styles.createButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('CreateEvent')}
          accessibilityRole="button"
          accessibilityLabel={t('organizerEvents.create')}
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Rounded-rectangle segmented control: surface track, raised fill on
          the selected half. Never a pill. */}
      {loading ? (
        <Skeleton width="100%" height={46} radius={radius.md} />
      ) : (
        <View style={styles.segmentTrack} accessibilityRole="tablist">
          {([
            { key: 'upcoming', label: t('organizerEvents.upcoming'), count: upcomingEvents.length },
            { key: 'past', label: t('organizerEvents.past'), count: pastEvents.length },
          ] as const).map((tab) => {
            const active = eventTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setEventTab(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${tab.label}, ${tab.count}`}
              >
                <Text
                  style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.segmentLabelInactive]}
                  numberOfLines={1}
                >
                  {`${tab.label} · ${tab.count}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        {/* Event cards: 2:3 poster thumb + status/title/meta/sales column. */}
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.eventCard}>
              <Skeleton width={THUMB_WIDTH} aspectRatio={2 / 3} radius={radius.button} />
              <View style={styles.eventContent}>
                <View>
                  <Skeleton width={70} height={10} radius={4} />
                  <Skeleton width="80%" height={18} radius={6} style={{ marginTop: 12 }} />
                  <Skeleton width="60%" height={13} radius={5} style={{ marginTop: 8 }} />
                </View>
                <View>
                  <Skeleton width={90} height={11} radius={4} />
                  <Skeleton width="100%" height={4} radius={2} style={{ marginTop: 8 }} />
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
      {header}

      {/* Events List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarSpace + 24 }]}
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
            art={artByKey(eventTab === 'upcoming' ? 'kanaval' : 'galri')}
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
            // Compact date — "Sat, Nov 18". The year only appears when it
            // isn't this one (mostly the Past tab). Time goes to the a11y label.
            const dateLabel = hasDate
              ? eventDate.toLocaleDateString(locale, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  ...(eventDate.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
                })
              : '';
            const timeLabel = hasDate
              ? eventDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
              : '';

            const displayStatus = getDisplayStatus(event, eventTab === 'past');
            const statusLabel = getStatusLabel(displayStatus);
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
            const metaLabel = [dateLabel, venueLabel].filter(Boolean).join(' · ');

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
                  timeLabel,
                  venueLabel,
                  statusLabel,
                  payoutBlocked ? t('organizerEvents.status.payoutBlocked') : null,
                  salesLabel,
                ].filter(Boolean).join(', ')}
                accessibilityHint={t('organizerEvents.manage')}
                onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id, event })}
              >
                {/* Portrait 2:3 poster thumb. Real image when we have one;
                    otherwise the poster gradient with a small centered wordmark. */}
                <View style={styles.eventThumb}>
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
                      <TikemWordmark fontSize={14} />
                    </View>
                  )}
                </View>

                <View style={styles.eventContent}>
                  <View>
                    <View style={styles.statusRow}>
                      <View style={styles.statusChips}>
                        <StatusChip status={getChipStatus(displayStatus)} label={statusLabel} />
                        {/* A live event whose payout account can no longer
                            accept a charge (set by the Connect health sweep).
                            Buyers would fail at checkout, so it always shows. */}
                        {payoutBlocked ? (
                          <StatusChip status="actionNeeded" label={t('organizerEvents.status.payoutBlocked')} />
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    {metaLabel ? (
                      <Text style={styles.metaText} numberOfLines={1}>
                        {metaLabel}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.salesBlock}>
                    <Text style={styles.salesText} numberOfLines={1}>{salesLabel}</Text>
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
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: colors.background,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  title: {
    flex: 1,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.text,
  },
  // Small filled square, not a pill and not a text button.
  createButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
  },
  segment: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.surfaceRaised,
  },
  segmentLabel: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  segmentLabelActive: {
    color: colors.text,
    fontWeight: '700',
  },
  segmentLabelInactive: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
    gap: 14,
  },
  // Filled surface card (never a hairline box).
  eventCard: {
    flexDirection: 'row',
    gap: 16,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  eventThumb: {
    width: THUMB_WIDTH,
    aspectRatio: 2 / 3,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
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
    paddingVertical: 4,
    justifyContent: 'space-between',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  statusChips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 4,
  },
  eventTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  metaText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  salesBlock: {
    marginTop: 14,
  },
  salesText: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  salesTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    marginTop: 8,
    overflow: 'hidden',
  },
  salesFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.text,
  },
});
