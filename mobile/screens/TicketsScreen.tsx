import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  StatusBar
} from 'react-native';
import { Image } from 'expo-image';
import { useTabBarSpace } from '../hooks/useTabBarSpace';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, MapPin, Ticket, ChevronRight } from 'lucide-react-native';
import { collection, query, where, getDocs, documentId } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { resolvePosterTheme } from '../lib/posterGradient';
import EmptyState from '../components/EmptyState';
import { artByKey } from '../lib/artLibrary';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import StatusChip from '../components/StatusChip';
import SegmentedTabs from '../components/organizer/SegmentedTabs';
import { format } from 'date-fns';
import { safeFormatForLanguage } from '../lib/dates';
import { useFocusEffect } from '@react-navigation/native';
import { consumeTicketsRefreshHint } from '../lib/ticketsRefreshHint';
import { font, radius } from '../theme/tokens';

// Offline-first cache: the door-scan moment is exactly when signal is worst, so
// we persist the resolved upcoming/past event lists per user and hydrate them
// instantly on launch. Dates are stored as ISO strings (JSON-safe) and revived
// on read. The individual QR still renders offline from TicketDetail's own cache.
const ticketsCacheKey = (uid: string) => `tickets_cache_${uid}`;

const serializeEvents = (events: any[]) =>
  events.map((e) => ({
    ...e,
    start_datetime: e.start_datetime ? new Date(e.start_datetime).toISOString() : null,
    end_datetime: e.end_datetime ? new Date(e.end_datetime).toISOString() : null,
  }));

const reviveEvents = (events: any[]) =>
  (events || []).map((e) => ({
    ...e,
    start_datetime: e.start_datetime ? new Date(e.start_datetime) : null,
    end_datetime: e.end_datetime ? new Date(e.end_datetime) : null,
  }));

/** Portrait poster thumb — the app's artwork is 2:3, so a square thumb cropped it. */
const POSTER_W = 60;
const POSTER_H = Math.round((POSTER_W * 3) / 2); // 90

// Dictionary keys for the two lifecycle labels the ticket detail screen never
// needed. `t()` echoes the key back when it is missing, so both are read through
// `withDictionaryFallback` until they land in the locale files.
const REFUNDED_KEY = 'ticketDetail.status.refunded';
const CANCELLED_KEY = 'ticketDetail.status.cancelled';

const withDictionaryFallback = (t: (key: string) => string, key: string, fallback: string) =>
  t(key) === key ? fallback : t(key);

/** How a group's tickets break down across the states a row can report. */
type TicketStatusSummary = {
  /** Still admits someone (valid / confirmed / active, never scanned). */
  active: number;
  used: number;
  refunded: number;
  cancelled: number;
};

/**
 * Roll an event's tickets into that summary. `checked_in_at` wins over `status`
 * (same precedence as `ticketStatusKey` in lib/ticket), and refunded/cancelled
 * tickets are counted apart because they no longer admit anyone.
 */
function summarizeTicketStatuses(tickets: any[]): TicketStatusSummary {
  const summary: TicketStatusSummary = { active: 0, used: 0, refunded: 0, cancelled: 0 };
  for (const ticket of tickets || []) {
    const raw = String(ticket?.status || '').toLowerCase();
    if (raw === 'refunded') summary.refunded++;
    else if (raw === 'cancelled' || raw === 'canceled') summary.cancelled++;
    else if (ticket?.checked_in_at || raw === 'used' || raw === 'checked_in') summary.used++;
    else summary.active++;
  }
  return summary;
}

/**
 * One status for a whole event group, mapped onto StatusChip's locked semantic
 * tones (dot + label, never a filled pill). Any ticket that still admits you
 * decides the row — that is the thing the attendee acts on; only when none is
 * left do the spent states (used, then refunded/cancelled) speak.
 * Past + unscanned reads EXPIRED, exactly as TicketDetailScreen labels it.
 */
function rowStatusFor(
  summary: TicketStatusSummary | undefined,
  isPast: boolean,
  t: (key: string) => string
): { status: string; label: string } {
  const s = summary;
  const spent = s ? s.used + s.refunded + s.cancelled : 0;
  // No summary at all (a list hydrated from an older cache) falls through here.
  if (!s || s.active > 0 || spent === 0) {
    return isPast
      ? { status: 'expired', label: t('ticketDetail.status.expired') }
      : { status: 'upcoming', label: t('tickets.upcoming') };
  }
  if (s.used > 0) return { status: 'used', label: t('ticketDetail.status.used') };
  if (s.refunded > 0) {
    return { status: 'void', label: withDictionaryFallback(t, REFUNDED_KEY, 'Refunded') };
  }
  return { status: 'void', label: withDictionaryFallback(t, CANCELLED_KEY, 'Cancelled') };
}

/** Placeholder rows that mirror the ticket-row layout (poster + text lines). */
function TicketsListSkeleton({ styles }: { styles: ReturnType<typeof getStyles> }) {
  return (
    <View>
      <Skeleton width={120} height={12} radius={5} style={styles.skeletonSectionHeader} />
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={styles.ticketRow}>
          <Skeleton width={POSTER_W} height={POSTER_H} radius={8} />
          <View style={styles.ticketBody}>
            <Skeleton width={'88%'} height={18} radius={6} />
            <Skeleton width={'64%'} height={12} radius={5} style={{ marginTop: 6 }} />
            <Skeleton width={'50%'} height={12} radius={5} style={{ marginTop: 6 }} />
            <Skeleton width={'40%'} height={11} radius={5} style={{ marginTop: 8 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function TicketsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { user } = useAuth();
  const { t, language } = useI18n();
  // The title bar is a blurred overlay now, so the tabs beneath it have to
  // reserve its measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [upcomingTickets, setUpcomingTickets] = useState<any[]>([]);
  const [pastTickets, setPastTickets] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once the list has actually scrolled underneath (see OverlayHeader).
  // The loading branch has no scroll container, so this stays 0 there and the
  // bar is simply solid — which is exactly the at-rest look.
  const scrollY = useRef(new Animated.Value(0)).current;

  const fetchTickets = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Fetch tickets. Paid tickets are stamped with `attendee_id` while
      // free/legacy tickets use `user_id`, so query BOTH fields and merge the
      // results de-duplicated by doc id (a ticket may carry both fields).
      const [byUserId, byAttendeeId] = await Promise.all([
        getDocs(query(collection(db, 'tickets'), where('user_id', '==', user.uid))),
        getDocs(query(collection(db, 'tickets'), where('attendee_id', '==', user.uid))),
      ]);
      const ticketDocsById = new Map<string, any>();
      [...byUserId.docs, ...byAttendeeId.docs].forEach(doc => {
        if (!ticketDocsById.has(doc.id)) ticketDocsById.set(doc.id, doc);
      });
      const ticketsData = Array.from(ticketDocsById.values()).map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          event_id: data.event_id,
          ...data,
          event_date: data.event_date?.toDate ? data.event_date.toDate() : data.event_date ? new Date(data.event_date) : null,
          purchase_date: data.purchase_date?.toDate ? data.purchase_date.toDate() : data.purchase_date ? new Date(data.purchase_date) : null
        } as any;
      });
      
      // Group tickets by event
      const ticketsByEvent = new Map();
      ticketsData.forEach(ticket => {
        if (!ticketsByEvent.has(ticket.event_id)) {
          ticketsByEvent.set(ticket.event_id, []);
        }
        ticketsByEvent.get(ticket.event_id).push(ticket);
      });
      
      // Fetch event details for all events with tickets in one batched pass.
      // Firestore's `in` query accepts up to 30 values, so chunk the ids and
      // issue one query per chunk instead of a getDocs per event (N+1).
      const eventIds = Array.from(ticketsByEvent.keys());
      const eventsData: any[] = [];

      for (let i = 0; i < eventIds.length; i += 30) {
        const chunk = eventIds.slice(i, i + 30);
        const eventsQuery = query(
          collection(db, 'events'),
          where(documentId(), 'in', chunk)
        );
        const eventsSnapshot = await getDocs(eventsQuery);
        eventsSnapshot.docs.forEach(eventDoc => {
          const eventData = eventDoc.data();
          const eventTickets = ticketsByEvent.get(eventDoc.id) || [];
          eventsData.push({
            id: eventDoc.id,
            ...eventData,
            start_datetime: eventData.start_datetime?.toDate ? eventData.start_datetime.toDate() : eventData.start_datetime ? new Date(eventData.start_datetime) : null,
            end_datetime: eventData.end_datetime?.toDate ? eventData.end_datetime.toDate() : eventData.end_datetime ? new Date(eventData.end_datetime) : null,
            ticketCount: eventTickets.length,
            // Plain counts — JSON-safe, so the offline cache carries them too.
            ticketStatusSummary: summarizeTicketStatuses(eventTickets),
          });
        });
      }
      
      // Separate upcoming and past events
      const now = new Date();
      const upcoming = eventsData
        .filter((e: any) => {
          const cutoff = e.end_datetime || e.start_datetime;
          return cutoff && new Date(cutoff) >= now;
        })
        .sort((a: any, b: any) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
      
      const past = eventsData
        .filter((e: any) => {
          const cutoff = e.end_datetime || e.start_datetime;
          return cutoff && new Date(cutoff) < now;
        })
        .sort((a: any, b: any) => new Date(b.start_datetime).getTime() - new Date(a.start_datetime).getTime());
      
      setUpcomingTickets(upcoming);
      setPastTickets(past);

      // Persist for offline-first launch next time (see ticketsCacheKey note).
      try {
        await AsyncStorage.setItem(
          ticketsCacheKey(user.uid),
          JSON.stringify({ upcoming: serializeEvents(upcoming), past: serializeEvents(past) }),
        );
      } catch {}
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Offline-first: paint cached tickets instantly (no blank/spinner gap, and
      // the list is available with no signal), then refresh from the network.
      if (user) {
        try {
          const raw = await AsyncStorage.getItem(ticketsCacheKey(user.uid));
          if (raw && !cancelled) {
            const c = JSON.parse(raw);
            setUpcomingTickets(reviveEvents(c.upcoming));
            setPastTickets(reviveEvents(c.past));
            setLoading(false);
          }
        } catch {}
      }
      if (!cancelled) fetchTickets();
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      let t1: any = null;
      let t2: any = null;

      const run = async () => {
        await fetchTickets();

        // If we just completed a payment, tickets might not be mirrored yet.
        // Retry a couple times with small delays.
        const hint = await consumeTicketsRefreshHint(2 * 60 * 1000);
        if (hint?.reason === 'payment') {
          t1 = setTimeout(() => {
            fetchTickets();
          }, 2000);
          t2 = setTimeout(() => {
            fetchTickets();
          }, 6000);
        }
      };

      run();

      return () => {
        if (t1) clearTimeout(t1);
        if (t2) clearTimeout(t2);
      };
    }, [user])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets();
  };

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <EmptyState
          icon={Ticket}
          title={t('auth.loginRequiredTitle')}
          subtitle={t('tickets.loginRequiredBody')}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
          <Text style={styles.headerTitle}>{t('tickets.title')}</Text>
        </OverlayHeader>
        {/* The header floats, so the tabs — the first in-flow row — carry its height. */}
        <View style={[styles.tabs, { marginTop: headerH }]}>
          <SegmentedTabs
            tabs={[
              { key: 'upcoming', label: t('tickets.upcoming') },
              { key: 'past', label: t('tickets.past') },
            ]}
            value="upcoming"
            onChange={() => {}}
          />
        </View>
        <TicketsListSkeleton styles={styles} />
      </View>
    );
  }

  const displayedTickets = activeTab === 'upcoming' ? upcomingTickets : pastTickets;

  // Group events into date sections (by month) for a tidy, scannable list.
  const sections = (() => {
    const groups: { key: string; label: string; items: any[] }[] = [];
    const indexByKey = new Map<string, number>();
    for (const event of displayedTickets) {
      const d = event.start_datetime ? new Date(event.start_datetime) : null;
      const valid = d && !Number.isNaN(d.getTime());
      const key = valid ? format(d as Date, 'yyyy-MM') : 'undated';
      const label = valid ? safeFormatForLanguage(d as Date, 'MMMM yyyy', language) : t('tickets.undated') || 'Undated';
      if (!indexByKey.has(key)) {
        indexByKey.set(key, groups.length);
        groups.push({ key, label, items: [] });
      }
      groups[indexByKey.get(key)!].items.push(event);
    }
    return groups;
  })();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <Text style={styles.headerTitle}>{t('tickets.title')}</Text>
      </OverlayHeader>

      {/* Tabs — quiet token tabs (beta feedback: the old full-width teal-
          underline band pulled focus from the tickets themselves). The header
          floats above them, so they reserve its measured height. */}
      <View style={[styles.tabs, { marginTop: headerH }]}>
        <SegmentedTabs
          tabs={[
            { key: 'upcoming', label: t('tickets.upcoming'), count: upcomingTickets.length },
            { key: 'past', label: t('tickets.past'), count: pastTickets.length },
          ]}
          value={activeTab}
          onChange={(key) => setActiveTab(key as 'upcoming' | 'past')}
        />
      </View>

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 24 + tabBarSpace }}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {displayedTickets.length === 0 ? (
          // A poster of Tikèm art instead of a lone icon: an empty wallet
          // should still feel like a night out waiting to happen.
          <EmptyState
            icon={Ticket}
            art={artByKey(activeTab === 'upcoming' ? 'konpa' : 'twoubadou')}
            title={activeTab === 'upcoming' ? t('tickets.emptyUpcomingTitle') : t('tickets.emptyPastTitle')}
            subtitle={activeTab === 'upcoming' ? t('tickets.emptyUpcomingBody') : t('tickets.emptyPastBody')}
            actionLabel={activeTab === 'upcoming' ? t('favorites.explore') : undefined}
            onAction={activeTab === 'upcoming' ? () => navigation.navigate('Discover') : undefined}
          />
        ) : (
          sections.map(section => (
            <View key={section.key}>
              <Text style={styles.sectionHeader}>{section.label}</Text>
              {section.items.map((event, index) => {
                const rowStatus = rowStatusFor(event.ticketStatusSummary, activeTab === 'past', t);
                const dateLabel = event.start_datetime
                  ? safeFormatForLanguage(event.start_datetime, 'EEE, MMM d • h:mm a', language)
                  : '';
                // Join only the parts we actually have, or a missing venue leaves
                // a dangling ", Port-au-Prince".
                const placeLabel = [event.venue_name, event.city].filter(Boolean).join(', ');

                return (
                  <TouchableOpacity
                    key={event.id}
                    style={[
                      styles.ticketRow,
                      index === section.items.length - 1 && styles.ticketRowLast,
                    ]}
                    onPress={() => navigation.navigate('EventTickets', { eventId: event.id })}
                    activeOpacity={0.6}
                  >
                    {/* Portrait poster (2:3) — a square thumb cropped the artwork. */}
                    <View style={styles.ticketPoster}>
                      {/* Fallback art only — behind a loading image this flashed
                          teal between skeleton and poster. */}
                      {!(event.banner_image_url || event.cover_image_url) && (
                        <LinearGradient
                          colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
                          start={{ x: 0.1, y: 0 }}
                          end={{ x: 0.9, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                      )}
                      {(event.banner_image_url || event.cover_image_url) && (
                        <Image
                          source={{ uri: event.banner_image_url || event.cover_image_url }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                          transition={200}
                          recyclingKey={event.id ? String(event.id) : undefined}
                        />
                      )}
                    </View>

                    <View style={styles.ticketBody}>
                      <Text style={styles.ticketTitle} numberOfLines={2}>{event.title}</Text>

                      {!!dateLabel && (
                        <View style={styles.ticketMetaRow}>
                          <Calendar size={12} color={colors.textSecondary} />
                          <Text style={styles.ticketMetaText} numberOfLines={1}>{dateLabel}</Text>
                        </View>
                      )}

                      {!!placeLabel && (
                        <View style={styles.ticketMetaRow}>
                          <MapPin size={12} color={colors.textSecondary} />
                          <Text style={styles.ticketMetaText} numberOfLines={1}>{placeLabel}</Text>
                        </View>
                      )}

                      {/* Status and count share ONE line, pinned to opposite edges,
                          so neither leaves an empty tail and the counts align in a
                          column down the list. Dot + label, never a filled pill;
                          the count is a label, so no chip either. */}
                      <View style={styles.ticketStatusLine}>
                        <StatusChip status={rowStatus.status} label={rowStatus.label} />
                        <View style={styles.ticketCountGroup}>
                          <Ticket size={11} color={colors.textTertiary} />
                          <Text style={styles.ticketCountText} numberOfLines={1}>
                            {event.ticketCount} {event.ticketCount === 1 ? t('tickets.ticketSingular') : t('tickets.ticketPlural')}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <ChevronRight size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </Animated.ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Overlay chrome (OverlayHeader owns the safe-area padding, the blur backdrop
  // and the absolute placement) — only the horizontal inset is ours.
  header: {
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0,
    color: colors.text,
  },
  tabs: {
    paddingVertical: 6,
  },
  content: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 4,
  },
  skeletonSectionHeader: {
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  // No card: the row sits directly on the black canvas and is separated by a
  // hairline (same idiom as the tier rows in TieredTicketSelector). Dropping the
  // fill hands the full row width back to the content.
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Last row of a month group — the next section header supplies the break.
  ticketRowLast: {
    borderBottomWidth: 0,
  },
  ticketPoster: {
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
  },
  ticketBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  ticketTitle: {
    fontFamily: font.serif,
    fontSize: 18,
    color: colors.text,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  ticketMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketMetaText: {
    flex: 1,
    fontSize: 11.5,
    letterSpacing: 0.3,
    color: colors.textSecondary,
  },
  ticketStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 1,
  },
  ticketCountGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  ticketCountText: {
    color: colors.textSecondary,
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});
