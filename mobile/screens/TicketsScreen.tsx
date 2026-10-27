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
import { Ticket, Heart } from 'lucide-react-native';
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

// Editorial direction (owner, Oct 2026): airy rows on the bare canvas, not
// boxed cards. A small 2:3 poster anchors each row; the premium weight comes
// from the type and the month dividers, not from a filled card.
const POSTER_W = 92;
const POSTER_H = Math.round((POSTER_W * 3) / 2); // 138

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
    <View style={styles.month}>
      <View style={styles.monthHead}>
        <Skeleton width={130} height={30} radius={4} />
      </View>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={POSTER_W} height={POSTER_H} radius={4} />
          <View style={styles.body}>
            <Skeleton width={'85%'} height={20} radius={4} />
            <Skeleton width={'60%'} height={12} radius={4} style={{ marginTop: 9 }} />
            <Skeleton width={'35%'} height={11} radius={4} style={{ marginTop: 12 }} />
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
  const [savedEvents, setSavedEvents] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past' | 'saved'>('upcoming');
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
      // Firestore runs on a memory-only cache here: offline, getDocs does not
      // throw, it resolves with whatever the session cache holds (often
      // nothing). Track that so an offline read never wipes the list.
      let fromCache = byUserId.metadata.fromCache || byAttendeeId.metadata.fromCache;
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
        // A ticket with no event_id would put `undefined` in the `in` query
        // below and fail the whole list, so skip it.
        if (!ticket.event_id) return;
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
        if (eventsSnapshot.metadata.fromCache) fromCache = true;
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
      
      if (fromCache) {
        // Offline (or a partial session-cache read): prefer the last saved
        // copy, and never overwrite it with this possibly empty result.
        let restored = false;
        try {
          const raw = await AsyncStorage.getItem(ticketsCacheKey(user.uid));
          if (raw) {
            const c = JSON.parse(raw);
            setUpcomingTickets(reviveEvents(c.upcoming));
            setPastTickets(reviveEvents(c.past));
            restored = true;
          }
        } catch {}
        if (!restored && eventsData.length > 0) {
          setUpcomingTickets(upcoming);
          setPastTickets(past);
        }
        return;
      }

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

  // Saved tab (TestFlight: "for saved or favorite events can you show them here
  // too?"). Favorites live in `event_favorites` (user_id → event_id); we hydrate
  // the events and show them in the same poster-forward cards, newest date first.
  const fetchFavorites = async () => {
    if (!user) return;
    try {
      const favSnap = await getDocs(
        query(collection(db, 'event_favorites'), where('user_id', '==', user.uid)),
      );
      if (favSnap.empty) {
        setSavedEvents([]);
        return;
      }
      const ids = favSnap.docs.map((d) => d.data().event_id).filter(Boolean);
      const events: any[] = [];
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const snap = await getDocs(
          query(collection(db, 'events'), where(documentId(), 'in', chunk)),
        );
        snap.docs.forEach((d) => {
          const data = d.data();
          events.push({
            id: d.id,
            ...data,
            start_datetime: data.start_datetime?.toDate
              ? data.start_datetime.toDate()
              : data.start_datetime
                ? new Date(data.start_datetime)
                : null,
            end_datetime: data.end_datetime?.toDate
              ? data.end_datetime.toDate()
              : data.end_datetime
                ? new Date(data.end_datetime)
                : null,
          });
        });
      }
      events.sort(
        (a, b) =>
          (a.start_datetime ? new Date(a.start_datetime).getTime() : 0) -
          (b.start_datetime ? new Date(b.start_datetime).getTime() : 0),
      );
      setSavedEvents(events);
    } catch (error) {
      console.error('Error fetching saved events:', error);
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
      if (!cancelled) {
        fetchTickets();
        fetchFavorites();
      }
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
        fetchFavorites();

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
    fetchFavorites();
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
              { key: 'saved', label: withDictionaryFallback(t, 'tickets.saved', 'Saved') },
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

  const isSaved = activeTab === 'saved';
  const displayedTickets =
    activeTab === 'upcoming' ? upcomingTickets : activeTab === 'past' ? pastTickets : savedEvents;

  // Group into month → day. Each month is an editorial divider (a big
  // lowercase serif month name over a ghosted month numeral); each day inside
  // it gets a small-caps date rule. This is our own premium way to carry the
  // passage of time, deliberately NOT Posh's left timeline rail.
  type DayGroup = { key: string; date: Date | null; items: any[] };
  type MonthGroup = { key: string; date: Date | null; days: DayGroup[] };
  const months = (() => {
    const out: MonthGroup[] = [];
    const monthIdx = new Map<string, number>();
    for (const event of displayedTickets) {
      const d = event.start_datetime ? new Date(event.start_datetime) : null;
      const valid = d && !Number.isNaN(d.getTime());
      const mKey = valid ? format(d as Date, 'yyyy-MM') : 'undated';
      const dKey = valid ? format(d as Date, 'yyyy-MM-dd') : 'undated';
      if (!monthIdx.has(mKey)) {
        monthIdx.set(mKey, out.length);
        out.push({ key: mKey, date: valid ? (d as Date) : null, days: [] });
      }
      const month = out[monthIdx.get(mKey)!];
      let day = month.days.find((x) => x.key === dKey);
      if (!day) {
        day = { key: dKey, date: valid ? (d as Date) : null, items: [] };
        month.days.push(day);
      }
      day.items.push(event);
    }
    return out;
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
            {
              key: 'saved',
              label: withDictionaryFallback(t, 'tickets.saved', 'Saved'),
              count: savedEvents.length,
            },
            { key: 'past', label: t('tickets.past'), count: pastTickets.length },
          ]}
          value={activeTab}
          onChange={(key) => setActiveTab(key as 'upcoming' | 'past' | 'saved')}
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
            icon={isSaved ? Heart : Ticket}
            art={artByKey(activeTab === 'past' ? 'twoubadou' : 'domino')}
            title={
              isSaved
                ? withDictionaryFallback(t, 'tickets.emptySavedTitle', 'Nothing saved yet')
                : activeTab === 'upcoming'
                  ? t('tickets.emptyUpcomingTitle')
                  : t('tickets.emptyPastTitle')
            }
            subtitle={
              isSaved
                ? withDictionaryFallback(
                    t,
                    'tickets.emptySavedBody',
                    'Tap the heart on an event to keep it here.',
                  )
                : activeTab === 'upcoming'
                  ? t('tickets.emptyUpcomingBody')
                  : t('tickets.emptyPastBody')
            }
            actionLabel={activeTab !== 'past' ? t('favorites.explore') : undefined}
            onAction={activeTab !== 'past' ? () => navigation.navigate('Discover') : undefined}
          />
        ) : (
          months.map((month, mi) => {
            // Big lowercase serif month over a ghosted numeral — a magazine
            // section break, not a plain list header.
            const monthName = month.date
              ? safeFormatForLanguage(month.date, 'MMMM', language)
              : t('tickets.undated') || 'Undated';
            const monthYear = month.date ? format(month.date, 'yyyy') : '';
            // The ghosted year folio prints only when the year changes (the
            // first month of each year), not on every divider.
            const prevDate = mi > 0 ? months[mi - 1].date : null;
            const prevYear = prevDate ? format(prevDate, 'yyyy') : '';
            const showYear = !!monthYear && monthYear !== prevYear;

            return (
              <View key={month.key} style={styles.month}>
                <View style={styles.monthHead}>
                  {showYear && (
                    <Text style={styles.ghostNum} allowFontScaling={false} numberOfLines={1}>
                      {monthYear}
                    </Text>
                  )}
                  <Text style={styles.monthName} numberOfLines={1}>
                    {monthName.toLowerCase()}
                  </Text>
                </View>

                {month.days.map((day) => {
                  const dayLabel = day.date
                    ? safeFormatForLanguage(day.date, 'EEEE d MMM', language).toUpperCase()
                    : '';

                  return (
                    <View key={day.key} style={styles.day}>
                      {!!dayLabel && (
                        <View style={styles.dayHead}>
                          <Text style={styles.dayLabel} numberOfLines={1}>
                            {dayLabel}
                          </Text>
                          <View style={styles.dayRule} />
                        </View>
                      )}

                      {day.items.map((event) => {
                        const rowStatus = rowStatusFor(
                          event.ticketStatusSummary,
                          activeTab === 'past',
                          t,
                        );
                        const timeLabel = event.start_datetime
                          ? safeFormatForLanguage(event.start_datetime, 'h:mm a', language)
                          : '';
                        const placeLabel = [event.venue_name, event.city]
                          .filter(Boolean)
                          .join(', ');
                        // One quiet line: time · venue (no per-line icons — the
                        // type carries it).
                        const metaLabel = [timeLabel, placeLabel].filter(Boolean).join('  ·  ');
                        const poster = event.banner_image_url || event.cover_image_url;

                        return (
                          <TouchableOpacity
                            key={event.id}
                            style={styles.row}
                            onPress={() =>
                              navigation.navigate(isSaved ? 'EventDetail' : 'EventTickets', {
                                eventId: event.id,
                              })
                            }
                            activeOpacity={0.7}
                          >
                            <View style={styles.poster}>
                              {!poster && (
                                <LinearGradient
                                  colors={
                                    resolvePosterTheme(
                                      event,
                                      event.id || event.title,
                                      event.category,
                                    ).colors
                                  }
                                  start={{ x: 0.1, y: 0 }}
                                  end={{ x: 0.9, y: 1 }}
                                  style={StyleSheet.absoluteFill}
                                />
                              )}
                              {!!poster && (
                                <Image
                                  source={{ uri: poster }}
                                  style={StyleSheet.absoluteFill}
                                  contentFit="cover"
                                  cachePolicy="memory-disk"
                                  transition={200}
                                  recyclingKey={event.id ? String(event.id) : undefined}
                                />
                              )}
                            </View>

                            <View style={styles.body}>
                              <Text style={styles.rowTitle} numberOfLines={2}>
                                {event.title}
                              </Text>
                              {!!metaLabel && (
                                <Text style={styles.rowMeta} numberOfLines={1}>
                                  {metaLabel}
                                </Text>
                              )}

                              <View style={styles.rowFoot}>
                                {isSaved ? (
                                  <View style={styles.savedTag}>
                                    <Heart size={12} color={colors.primary} fill={colors.primary} />
                                    <Text style={styles.savedText}>
                                      {withDictionaryFallback(t, 'tickets.savedLabel', 'Saved')}
                                    </Text>
                                  </View>
                                ) : (
                                  <>
                                    <StatusChip status={rowStatus.status} label={rowStatus.label} />
                                    <Text style={styles.countSep}>·</Text>
                                    <Text style={styles.count} numberOfLines={1}>
                                      {event.ticketCount}{' '}
                                      {event.ticketCount === 1
                                        ? t('tickets.ticketSingular')
                                        : t('tickets.ticketPlural')}
                                    </Text>
                                  </>
                                )}
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            );
          })
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
  // Month divider — a magazine section break: a big lowercase serif month name
  // over a huge, barely-there ghosted numeral.
  month: {
    marginHorizontal: 20,
  },
  monthHead: {
    position: 'relative',
    justifyContent: 'flex-end',
    minHeight: 58,
    marginTop: 30,
    marginBottom: 2,
  },
  // The year, set huge and barely-there behind the month name — a magazine
  // folio. Four digits, so a touch smaller than a 2-digit numeral and allowed
  // to sit against the right edge.
  ghostNum: {
    position: 'absolute',
    right: -2,
    top: -6,
    fontSize: 66,
    fontWeight: '800',
    letterSpacing: -2,
    color: 'rgba(255,255,255,0.05)',
  },
  monthName: {
    fontFamily: font.serif,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
  },
  // One day inside a month.
  day: {
    marginTop: 20,
  },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dayLabel: {
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  dayRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  skeletonSectionHeader: {
    marginTop: 30,
    marginBottom: 2,
  },
  // Editorial row — poster + type on the bare canvas, no box.
  row: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  poster: {
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
  },
  body: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  rowTitle: {
    fontFamily: font.serif,
    fontSize: 20,
    lineHeight: 23,
    color: colors.text,
    letterSpacing: -0.2,
  },
  rowMeta: {
    fontSize: 12.5,
    letterSpacing: 0.1,
    color: colors.textSecondary,
    marginTop: 5,
  },
  rowFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 9,
  },
  countSep: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  count: {
    color: colors.textSecondary,
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  savedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savedText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
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
