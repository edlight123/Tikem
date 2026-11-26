import React, { useState, useEffect, useCallback, useRef } from 'react';
import { isUnlisted } from '../../lib/eventVisibility';
import { useTabTaps } from '../../hooks/useTabTaps';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
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
import { useActiveOrg } from '../../lib/activeOrg';
import { useI18n } from '../../contexts/I18nContext';
import { getOrganizerEvents, OrganizerEvent } from '../../lib/api/organizer';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { radius, font } from '../../theme/tokens';
import { Skeleton, ShimmerImage } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import { select as hapticSelect } from '../../lib/haptics';
import EmptyState from '../../components/EmptyState';
import { artByKey } from '../../lib/artLibrary';
import StatusChip from '../../components/StatusChip';
import { TikemWordmark } from '../../components/TikemWordmark';
import { displayCapacity } from '../../lib/ticketPricing';
import { formatEventClock } from '../../lib/eventClock';
import { soldForPeople } from '../../lib/printedBundle';

type EventStatus =
  | 'on_sale'
  | 'completed'
  | 'draft'
  | 'unpublished'
  | 'sold_out'
  | 'rejected'
  | 'cancelled';

// Row geometry, shared by the loaded rows and the skeleton so nothing jumps
// when data lands. Flyers are 4:5 with text baked in, so the thumb keeps 4:5.
const THUMB_WIDTH = 104;

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

  // The acting org's events (lib/activeOrg.ts), not the signed-in uid's.
  const { orgId, can } = useActiveOrg();

  useEffect(() => {
    setLoading(true);
    setAllEvents([]);
  }, [orgId]);

  const loadEvents = useCallback(async () => {
    if (!orgId) return;

    try {
      const eventsData = await getOrganizerEvents(orgId, 100);
      setAllEvents(eventsData);
    } catch (error) {
      console.error('Error loading organizer events:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

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
  // Tap the tab again to scroll up; tap twice to refresh.
  const eventsScroll = useRef<any>(null);
  useTabTaps(eventsScroll, onRefresh);

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

  // "Can't take payments" (`payout_blocked`) is caused by the payout account,
  // which is fixed from Earnings/Payouts, so this list carries no banner for it
  // (TestFlight #176). When only SOME live events are blocked, those cards
  // still carry it as their one status.
  const isLive = (e: OrganizerEvent) =>
    e.is_published && e.status !== 'cancelled' && (e as any).rejected !== true;
  const liveUpcoming = upcomingEvents.filter(isLive);
  const blockedCount = liveUpcoming.filter((e) => Boolean((e as any).payout_blocked)).length;
  const allLiveBlocked = blockedCount > 0 && blockedCount === liveUpcoming.length;

  const getDisplayStatus = (event: OrganizerEvent, isPast: boolean): EventStatus => {
    if ((event as any).rejected === true) return 'rejected';
    if (event.status === 'cancelled') return 'cancelled';
    if (!event.is_published) return event.status === 'draft' ? 'draft' : 'unpublished';
    // `total_tickets > 0` guard: an event with no capacity set used to read
    // as sold out because 0 >= 0.
    const cap = displayCapacity(event.total_tickets);
    if (cap > 0 && (event.tickets_sold || 0) >= cap) return 'sold_out';
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
          {t('organizerEvents.title').toLowerCase()}
        </Text>
        {/* Bring events over from Eventbrite, Luma, Meetup or any event page. */}
        {can('manage_events') ? (
          <Touchable
            style={styles.createButton}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={() => navigation.navigate('ImportEvents')}
            accessibilityRole="button"
            accessibilityLabel={t('organizerImport.title')}
          >
            <Ionicons name="download-outline" size={20} color={colors.text} />
          </Touchable>
        ) : null}
        <Touchable
          style={styles.createButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => navigation.navigate('CreateEvent')}
          accessibilityRole="button"
          accessibilityLabel={t('organizerEvents.create')}
        >
          <Ionicons name="add" size={24} color={colors.text} />
        </Touchable>
      </View>

      {/* Rounded-rectangle segmented control: surface track, raised fill on
          the selected half. Never a pill. */}
      {loading ? (
        // The same underline-tab track as the loaded control (two labels,
        // 24pt apart, 4/10 padding over the hairline), not a 30pt slab.
        <View style={styles.segmentTrack}>
          {[96, 64].map((w) => (
            <View key={w} style={styles.segment}>
              <Skeleton width={w} height={15} radius={4} style={{ marginVertical: 2 }} />
            </View>
          ))}
        </View>
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
                activeOpacity={0.7}
                onPress={() => {
                  if (!active) hapticSelect();
                  setEventTab(tab.key);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${tab.label}, ${tab.count}`}
              >
                <Text
                  style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.segmentLabelInactive]}
                  numberOfLines={1}
                >
                  {tab.label}  <Text style={styles.segmentCount}>{tab.count}</Text>
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
        {/* Event rows: 4:5 poster + status/title/meta/sales column. */}
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.eventCard}>
              <Skeleton width={THUMB_WIDTH} aspectRatio={4 / 5} radius={radius.poster} />
              <View style={styles.eventContent}>
                <View>
                  <Skeleton width={70} height={10} radius={4} />
                  <Skeleton width="80%" height={18} radius={4} style={{ marginTop: 12 }} />
                  <Skeleton width="60%" height={13} radius={4} style={{ marginTop: 8 }} />
                </View>
                <Skeleton width="100%" height={2} radius={1} />
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
        ref={eventsScroll}
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
            art={artByKey(eventTab === 'upcoming' ? 'photo-kilti-parade' : 'photo-mizik-tabou')}
            title={eventTab === 'upcoming' ? t('organizerEvents.emptyUpcomingTitle') : t('organizerEvents.emptyPastTitle')}
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
              ? formatEventClock(eventDate, event as any, locale)
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

            // People only: unsold printed seats sit inside tickets_sold.
            const sold = soldForPeople(event);
            const capacity = displayCapacity(event.total_tickets);
            const soldRatio = capacity > 0 ? Math.min(1, sold / capacity) : 0;
            const salesLabel = capacity > 0
              ? `${sold}/${capacity} ${t('common.sold')}`
              : `${sold} ${t('common.sold')}`;
            // One line: date · venue · sales.
            const metaLine = [metaLabel, salesLabel].filter(Boolean).join(' · ');
            // ONE status per card. The payout problem replaces "On sale" only
            // when some, not all, live events are blocked (see above).
            const showBlockedOnCard = payoutBlocked && !allLiveBlocked;

            return (
              <Touchable
                key={event.id}
                scale={0.98}
                style={styles.eventCard}
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
                {/* Standalone 4:5 poster on the canvas. Real image when we have
                    one; otherwise the poster gradient with a small centered wordmark. */}
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
                    <ShimmerImage
                      uri={posterUri}
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
                      {showBlockedOnCard ? (
                        <StatusChip status="actionNeeded" label={t('organizerEvents.status.payoutBlocked')} />
                      ) : (
                        <StatusChip status={getChipStatus(displayStatus)} label={statusLabel} />
                      )}
                      {isUnlisted(event as any) && (
                        <StatusChip status="neutral" label={t('eventVisibility.unlisted')} />
                      )}
                    </View>
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    <Text style={styles.metaText} numberOfLines={1}>
                      {metaLine}
                    </Text>
                  </View>

                  {/* Only once something has sold: an empty track reads as a fault. */}
                  {capacity > 0 && sold > 0 ? (
                    <View style={styles.salesTrack}>
                      <View style={[styles.salesFill, { width: `${soldRatio * 100}%` }]} />
                    </View>
                  ) : null}
                </View>
              </Touchable>
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
    marginBottom: 12,
  },
  // Editorial serif title, the same voice as the section rails, instead of
  // a 36pt heavy grotesk (TestFlight 2026-11-12: "don't like the header style").
  title: {
    flex: 1,
    fontFamily: font.serif,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
  },
  // Small filled square, not a pill and not a text button.
  createButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Plain text tabs with a short underline on the selected one, posh-style.
  // The boxed segmented track read heavy under the title (owner, 2026-11-16).
  segmentTrack: {
    flexDirection: 'row',
    gap: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  segment: {
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  segmentActive: {
    borderBottomColor: colors.text,
  },
  segmentLabel: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  segmentLabelActive: {
    color: colors.text,
    fontWeight: '600',
  },
  segmentCount: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  segmentLabelInactive: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
    gap: 20,
  },
  // Like EventListCard: no card fill, poster left, details right. Rows are
  // separated by the list gap, never a hairline.
  eventCard: {
    flexDirection: 'row',
    gap: 16,
  },
  // surfaceRaised is the poster's own placeholder while the image loads.
  eventThumb: {
    width: THUMB_WIDTH,
    aspectRatio: 4 / 5,
    borderRadius: radius.poster,
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
    paddingVertical: 2,
    justifyContent: 'space-between',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  eventTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: colors.text,
  },
  metaText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  salesTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.surfaceRaised,
    marginTop: 12,
    overflow: 'hidden',
  },
  salesFill: {
    height: '100%',
    borderRadius: 1,
    backgroundColor: colors.text,
  },
});
