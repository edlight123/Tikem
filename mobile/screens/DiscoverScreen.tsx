import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  StyleSheet, 
  TouchableOpacity,
    Image,
  RefreshControl,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../hooks/useTabBarSpace';
import { Search, SlidersHorizontal, Users, CloudOff, MapPin, ChevronDown } from 'lucide-react-native';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { filterExploreEvents } from '../lib/api/events';
import { fetchPublishedEventsForCountry } from '../lib/api/eventFeed';
import { filterBlockedEvents, useBlockedOrganizers } from '../lib/blockedOrganizers';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';
import EventFiltersSheet from '../components/EventFiltersSheet';
import EmptyState from '../components/EmptyState';
import { Skeleton, DiscoverFeedSkeleton } from '../components/Skeleton';
import { DateFilter } from '../components/DateChips';
import WhenPickerSheet from '../components/WhenPickerSheet';
import LocationPickerSheet from '../components/LocationPickerSheet';
import { useFilters } from '../contexts/FiltersContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import DiscoverEventCard from '../components/DiscoverEventCard';
import ElsewhereRail from '../components/ElsewhereRail';
import { useAppAlert } from '../components/AppAlert';
import { applyFilters } from '../utils/filterUtils';
import { DEFAULT_FILTERS } from '../types/filters';
import { getDateRange } from '../utils/filters';
import { fetchFriendsGoingCounts } from '../lib/api/social';
import { shareEvent } from '../lib/share';
import { elsewhereEvents } from '../data/metros';
import { useActiveLocationCopy } from '../lib/locationCopy';

export default function DiscoverScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const {
    appliedFilters,
    openFiltersModal,
    hasActiveFilters,
    countActiveFilters,
    applyFiltersDirectly,
    resetFilters,
    userCountry,
    countryResolved,
    activeCity,
    activeMetro,
    activeLocationLabel,
    setActiveCity,
  } = useFilters();
  // Blocked organizers' events never reach the feed; a change re-runs the fetch.
  const blockedOrganizers = useBlockedOrganizers();
  const { user } = useAuth();
  const { t, language } = useI18n();
  // The active location, in words — every empty state and the header chip.
  const locationCopy = useActiveLocationCopy();
  const showAlert = useAppAlert();
  
  const [allEvents, setAllEvents] = useState<any[]>([]);
  const [friendsGoingCounts, setFriendsGoingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<DateFilter>('any');
  const [pickedDate, setPickedDate] = useState<string | undefined>();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [whereSheetOpen, setWhereSheetOpen] = useState(false);
  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  // Posh-style Discover: a focused feed with For You / Following / Saved tabs.
  const [feedEvents, setFeedEvents] = useState<any[]>([]);
  // Top events from OTHER metros in the same country/region. Kept in its own
  // state, rendered under its own header — never merged into the feed.
  const [elsewhere, setElsewhere] = useState<any[]>([]);
  const [discoverTab, setDiscoverTab] = useState<'forYou' | 'following' | 'saved'>('forYou');
  const [savedEvents, setSavedEvents] = useState<any[]>([]);
  // Which events the user has bookmarked — drives the card's save icon state
  // across all tabs (loaded once per user, updated optimistically on toggle).
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const scrollViewRef = useRef<ScrollView>(null);
  // Full header height — the feed's top padding, so content scrolls UP behind
  // the transparent header instead of starting below a solid strip. Measured
  // once at rest; a sane default until then.
  const [headerH, setHeaderH] = useState(160);
  const headerMeasured = useRef(false);

  // Header collapse-on-scroll: as the feed scrolls down we crossfade the full
  // search pill + tabs out and a compact search/filter icon row in, so the
  // poster fills the screen. Layout/opacity animation → useNativeDriver:false.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const COLLAPSE_AT = 72;

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      setIsCollapsed((prev) => {
        if (!prev && value > COLLAPSE_AT) return true;
        // Hysteresis so it doesn't flicker right at the threshold.
        if (prev && value < COLLAPSE_AT - 20) return false;
        return prev;
      });
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  const expandedOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_AT],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const collapsedOpacity = scrollY.interpolate({
    inputRange: [COLLAPSE_AT * 0.5, COLLAPSE_AT],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Hold the first fetch (the skeleton stays up) until the country is hydrated,
  // and re-fetch when it changes: the country is a QUERY predicate now, so
  // fetching with the locale-guessed placeholder would pull another market's
  // catalogue entirely. Same rule as Home.
  useEffect(() => {
    if (!countryResolved) return;
    fetchEvents();
  }, [userCountry, countryResolved, blockedOrganizers]);

  // Listen for tab press to scroll to top and reset filters
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', (e: any) => {
      // Check if we're already on this screen
      const state = navigation.getState();
      const currentRoute = state.routes[state.index];
      if (currentRoute.name === 'Discover') {
        // Scroll to top
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
        // Reset filters and search. The LOCATION survives on purpose —
        // resetFilters keeps it — so a tab press never moves you to another
        // market without you asking.
        resetFilters();
        setSearchQuery('');
        setSelectedDate('any');
        setSelectedCategories([]);
        // Reset route params
        navigation.setParams({ category: undefined, trending: undefined, thisWeek: undefined });
      }
    });

    return unsubscribe;
  }, [navigation]);

  // Handle special navigation params: category, trending, thisWeek, allEvents
  useEffect(() => {
    const { category, trending, thisWeek, allEvents, timestamp } = route?.params || {};
    
    if (category) {
      console.log('[DiscoverScreen] Applying category filter:', category);
      // Keep the LOCATION. Spreading DEFAULT_FILTERS alone reset country and
      // city, so arriving from a category chip silently un-scoped the feed.
      applyFiltersDirectly({
        ...DEFAULT_FILTERS,
        country: userCountry,
        city: activeCity,
        categories: [category],
      });
    } else if (trending) {
      console.log('[DiscoverScreen] Filtering for trending events');
      // Filter trending events in organizeEvents
      setSearchQuery('');
    } else if (thisWeek) {
      console.log('[DiscoverScreen] Filtering for this week events');
      // Filter this week events in organizeEvents
      setSearchQuery('');
    } else if (allEvents) {
      console.log('[DiscoverScreen] Showing all events list');
      // This will skip featured carousels and show full list
      setSearchQuery('');
    }
  }, [route?.params?.category, route?.params?.trending, route?.params?.thisWeek, route?.params?.allEvents, route?.params?.timestamp]);

  // Re-organize events when filters change
  useEffect(() => {
    if (allEvents.length > 0) {
      organizeEvents();
    }
  }, [allEvents, appliedFilters, searchQuery, selectedDate, pickedDate, selectedCategories, route?.params]);

  const fetchEvents = async () => {
    // The country is a query predicate now — never fetch before it resolves.
    // Pull to refresh can fire before hydration, so guard here as well as in
    // the mount effect.
    if (!countryResolved) {
      setRefreshing(false);
      return;
    }
    setError(false);
    try {
      // Published events IN THE ACTIVE COUNTRY, server-side. `limit(50)` with no
      // location predicate made these 50 rows a location-blind sample of the
      // whole catalogue: past ~50 published events a Miami user could receive 50
      // Haitian events, filter to Miami on the device, match none, and be told
      // Miami is empty while Miami events sat unfetched. See lib/api/eventFeed.ts.
      const eventsData = await fetchPublishedEventsForCountry(userCountry);
      console.log(
        '[DiscoverScreen] Fetched',
        eventsData.length,
        'published events in',
        userCountry
      );

      // Sort client-side so the query needs no ORDERED composite index (the
      // equality-only is_published + country index is enough).
      eventsData.sort((a, b) => {
        const aTime = a?.start_datetime ? new Date(a.start_datetime).getTime() : Number.POSITIVE_INFINITY
        const bTime = b?.start_datetime ? new Date(b.start_datetime).getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      })
      
      // Hide moderator-rejected events (client-side so we don't need a new
      // composite index). Missing field = not rejected, so existing events show.
      const notRejected = (eventsData as any[]).filter((e) => e.rejected !== true);

      // Hide events the organizer marked as not shown on Explore (unlisted).
      // Missing field = visible, so existing events are unaffected.
      // …and events from organizers this user blocked (App Store 1.2).
      const exploreEvents = filterBlockedEvents(filterExploreEvents(notRejected), blockedOrganizers);

      const now = new Date();
      const futureEvents = exploreEvents.filter((event) => {
        const start = event.start_datetime ? new Date(event.start_datetime) : null
        const end = event.end_datetime ? new Date(event.end_datetime) : null
        const cutoff = end || start
        if (!cutoff) return false
        return cutoff >= now
      });

      console.log('[DiscoverScreen] Future events:', futureEvents.length, 'out of', exploreEvents.length, 'total');
      setAllEvents(futureEvents.length > 0 ? futureEvents : exploreEvents);
    } catch (err) {
      console.error('[DiscoverScreen] Error fetching events:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchEvents();
  };

  // Load the user's saved (favorited) event ids once so the bookmark icon shows
  // the right state on every card, not just the Saved tab.
  const loadSavedIds = useCallback(async () => {
    if (!user) { setSavedIds(new Set()); return; }
    try {
      const favs = await getDocs(
        query(collection(db, 'event_favorites'), where('user_id', '==', user.uid))
      );
      setSavedIds(new Set(favs.docs.map((d) => d.data().event_id)));
    } catch (e) {
      console.warn('[DiscoverScreen] Error loading saved ids:', e);
    }
  }, [user]);

  useEffect(() => { loadSavedIds(); }, [loadSavedIds]);

  // Share an event (native share sheet) via the shared, localized helper.
  const handleShareEvent = useCallback((event: any) => shareEvent(event, language), [language]);

  // Clear every active filter (context + local) so the "Clear filters" CTA on an
  // empty feed brings the full list back.
  const handleClearFilters = useCallback(() => {
    resetFilters();
    setSearchQuery('');
    setSelectedDate('any');
    setSelectedCategories([]);
  }, [resetFilters]);

  // Toggle bookmark: optimistic UI + event_favorites write (add/remove).
  const toggleSaveEvent = useCallback(async (event: any) => {
    if (!user) {
      showAlert(t('auth.loginRequiredTitle'), t('eventDetail.favorites.loginBody'));
      return;
    }
    const id = event.id;
    const wasSaved = savedIds.has(id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(id); else next.add(id);
      return next;
    });
    try {
      if (wasSaved) {
        const snap = await getDocs(query(
          collection(db, 'event_favorites'),
          where('user_id', '==', user.uid),
          where('event_id', '==', id),
        ));
        await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, 'event_favorites', d.id))));
        setSavedEvents((prev) => prev.filter((e) => e.id !== id));
      } else {
        await addDoc(collection(db, 'event_favorites'), {
          user_id: user.uid,
          event_id: id,
          created_at: Timestamp.now(),
        });
      }
    } catch (e) {
      console.warn('[DiscoverScreen] Toggle save failed:', e);
      // Roll back the optimistic change on failure.
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(id); else next.delete(id);
        return next;
      });
    }
  }, [user, savedIds, t]);

  // Saved tab — the user's favorited events, matched against the loaded set.
  useEffect(() => {
    if (discoverTab !== 'saved' || !user) return;
    let active = true;
    (async () => {
      try {
        const favs = await getDocs(
          query(collection(db, 'event_favorites'), where('user_id', '==', user.uid))
        );
        const ids = new Set(favs.docs.map((d) => d.data().event_id));
        if (active) setSavedEvents(allEvents.filter((e) => ids.has(e.id)));
      } catch (e) {
        console.error('[DiscoverScreen] Error loading saved events:', e);
      }
    })();
    return () => {
      active = false;
    };
  }, [discoverTab, user, allEvents]);

  // Load "friends going" counts whenever the visible event set changes.
  useEffect(() => {
    const ids = allEvents.map((e) => e?.id).filter(Boolean);
    if (ids.length === 0) {
      setFriendsGoingCounts({});
      return;
    }
    let active = true;
    fetchFriendsGoingCounts(ids)
      .then((counts) => {
        if (active) setFriendsGoingCounts(counts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [allEvents]);

  const filterBySearch = (events: any[]) => {
    if (!searchQuery.trim()) return events;
    const query = searchQuery.toLowerCase();
    return events.filter(event => 
      event.title?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query) ||
      event.venue_name?.toLowerCase().includes(query) ||
      event.city?.toLowerCase().includes(query) ||
      event.category?.toLowerCase().includes(query)
    );
  };

  const filterByDate = (events: any[]) => {
    const { start, end } = getDateRange(selectedDate, pickedDate);
    
    // If no date range (filter is 'any'), return all events
    if (!start && !end) return events;
    
    return events.filter(event => {
      const eventDate = new Date(event.start_datetime);
      
      // If event has a start date, check if it falls within the range
      if (start && eventDate < start) return false;
      if (end && eventDate > end) return false;
      
      return true;
    });
  };

  const filterByCategory = (events: any[]) => {
    if (selectedCategories.length === 0) return events;
    return events.filter(event => 
      selectedCategories.includes(event.category)
    );
  };

  const filterByTrending = (events: any[]) => {
    return events.filter(e => (e.tickets_sold || 0) > 10);
  };

  const filterByThisWeek = (events: any[]) => {
    const now = new Date();
    const oneWeekFromNow = new Date(now);
    oneWeekFromNow.setDate(now.getDate() + 7);
    return events.filter(e => e.start_datetime && e.start_datetime <= oneWeekFromNow);
  };

  const organizeEvents = () => {
    let events = [...allEvents];
    const { trending, thisWeek } = route?.params || {};

    // Apply special filters from navigation
    if (trending) {
      events = filterByTrending(events);
    } else if (thisWeek) {
      events = filterByThisWeek(events);
    }

    // Location + filters, in one pass. `appliedFilters` carries the ONE active
    // location (country + town → metro).
    //
    // There is NO fallback here any more. This used to drop the country AND the
    // city whenever filtering came back empty, which is why browsing from Miami
    // showed Haiti and New York events. An empty feed that names where you are
    // is honest; a full feed from somewhere else is not. See the empty state
    // below and the clearly-labelled "elsewhere in …" rail.
    events = applyFilters(events, appliedFilters);
    events = filterByDate(events);
    events = filterByCategory(events);
    events = filterBySearch(events);

    // The single, filtered + chronologically sorted feed used by the "For You" tab.
    const feed = [...events].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
    );
    setFeedEvents(feed);

    // The one labelled rail: same country (or same region in a big country),
    // OTHER metros. Same date/category rules as the feed, only the location
    // differs — and it is rendered separately, under its own header.
    const searching = searchQuery.trim() !== '';
    if (searching || !activeMetro) {
      setElsewhere([]);
      return;
    }
    const countryWide = filterByCategory(
      filterByDate(applyFilters([...allEvents], { ...appliedFilters, city: '' }))
    );
    setElsewhere(
      elsewhereEvents(countryWide, activeMetro).sort(
        (a, b) => (b.tickets_sold || 0) - (a.tickets_sold || 0)
      )
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View
          style={[styles.header, { paddingTop: insets.top + 8 }]}
          onLayout={(e) => {
            const h = e?.nativeEvent?.layout?.height ?? 0;
            if (h) setHeaderH(h);
          }}
        >
          <Skeleton height={44} radius={22} style={{ width: '100%' }} />
          <View style={styles.tabsRow}>
            <Skeleton width={64} height={16} radius={6} />
            <Skeleton width={78} height={16} radius={6} />
            <Skeleton width={52} height={16} radius={6} />
          </View>
        </View>
        {/* The header above is position: absolute — without this inset the
            skeleton cards rendered UNDERNEATH the search bar. Same reservation
            the loaded feed uses. */}
        <View style={{ paddingTop: headerH + 8 }}>
          <DiscoverFeedSkeleton />
        </View>
      </View>
    );
  }

  const renderFeed = (
    list: any[],
    emptyTitle: string,
    emptySubtitle: string,
    emptyAction?: { label: string; onAction: () => void },
    emptyIcon: typeof Search = Search,
  ) =>
    list.length === 0 ? (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        subtitle={emptySubtitle}
        actionLabel={emptyAction?.label}
        onAction={emptyAction?.onAction}
      />
    ) : (
      list.map((event) => (
        <DiscoverEventCard
          key={event.id}
          event={event}
          saved={savedIds.has(event.id)}
          onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
          onShare={() => handleShareEvent(event)}
          onToggleSave={() => toggleSaveEvent(event)}
        />
      ))
    );

  // Ambient backdrop: the top poster of the active list, heavily blurred and
  // faded, so its colours wash faintly behind the header + feed instead of pure
  // black. Fades to solid black lower down so content stays legible.
  const ambientList = discoverTab === 'saved' ? savedEvents : feedEvents;
  const ambientUri = ambientList[0]?.banner_image_url || ambientList[0]?.cover_image_url || null;

  return (
    <View style={styles.container}>
      {ambientUri ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image source={{ uri: ambientUri }} style={styles.ambientImg} blurRadius={40} />
          <LinearGradient
            colors={['rgba(10,10,10,0.35)', 'rgba(10,10,10,0.9)', '#0A0A0A']}
            locations={[0, 0.55, 0.82]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}

      {/* Posh-style header: a fully transparent overlay the feed scrolls under
          (no scrim box) so the poster shows cleanly through. Only a very subtle
          top-only gradient keeps the controls legible on bright posters. On
          scroll it collapses to a compact search + filter icon row. */}
      <View
        style={[styles.header, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
        onLayout={(e) => {
          if (headerMeasured.current) return;
          const h = e.nativeEvent.layout.height;
          if (h > 40) {
            headerMeasured.current = true;
            setHeaderH(h);
          }
        }}
      >
        <LinearGradient
          colors={['rgba(10,10,10,0.5)', 'rgba(10,10,10,0)']}
          style={styles.headerGradient}
          pointerEvents="none"
        />

        {/* Expanded state: full search pill + tabs. */}
        <Animated.View
          style={{ opacity: expandedOpacity }}
          pointerEvents={isCollapsed ? 'none' : 'box-none'}
        >
          {/* The active location, always visible: browsing is scoped to it, so
              the screen has to say which market you are in — and let you leave
              it in one tap. */}
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => setWhereSheetOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={locationCopy.locationName}
          >
            <MapPin size={13} color={colors.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {locationCopy.locationName}
            </Text>
            <ChevronDown size={14} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.searchRow}>
            {/* Tapping the search pill opens the dedicated full-screen Search. */}
            <TouchableOpacity
              style={styles.searchPill}
              onPress={() => navigation.navigate('Search')}
              activeOpacity={0.75}
            >
              <Search size={20} color={colors.textSecondary} />
              <Text style={styles.searchPlaceholder} numberOfLines={1}>
                {t('discover.searchPlaceholder')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterBtn} onPress={openFiltersModal} activeOpacity={0.7}>
              <SlidersHorizontal size={20} color={colors.text} />
              {countActiveFilters() > 0 && (
                <View style={styles.filterCountBadge}>
                  <Text style={styles.filterCountText}>{countActiveFilters()}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.tabsRow}>
            {([
              { key: 'forYou', label: t('discover.tabs.forYou') },
              { key: 'following', label: t('discover.tabs.following') },
              { key: 'saved', label: t('discover.tabs.saved') },
            ] as const).map((tab) => (
              <TouchableOpacity key={tab.key} onPress={() => setDiscoverTab(tab.key)} hitSlop={8}>
                <Text style={[styles.tabText, discoverTab === tab.key && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Collapsed state: compact search + filter icons only (max poster). */}
        <Animated.View
          style={[styles.collapsedRow, { top: insets.top + 8, opacity: collapsedOpacity }]}
          pointerEvents={isCollapsed ? 'box-none' : 'none'}
        >
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => navigation.navigate('Search')}
            activeOpacity={0.7}
          >
            <Search size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterBtn} onPress={openFiltersModal} activeOpacity={0.7}>
            <SlidersHorizontal size={20} color={colors.text} />
            {countActiveFilters() > 0 && (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{countActiveFilters()}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Feed */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.contentUnderHeader}
        contentContainerStyle={[styles.feedContent, { paddingTop: headerH + 8, paddingBottom: 32 + tabBarSpace }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {error && allEvents.length === 0 ? (
          <EmptyState
            icon={CloudOff}
            title={t('common.loadErrorTitle')}
            subtitle={t('common.loadErrorSubtitle')}
            actionLabel={t('common.retry')}
            onAction={onRefresh}
          />
        ) : (
          <>
            {discoverTab === 'forYou' && (
              <>
                {/* Nothing here? Say WHERE there is nothing, and offer the one
                    move that can change it. Never quietly show another market. */}
                {hasActiveFilters()
                  ? renderFeed(
                      feedEvents,
                      t('discover.noEventsFound'),
                      t('discover.tryAdjusting'),
                      { label: t('discover.clearFilters'), onAction: handleClearFilters },
                    )
                  : renderFeed(
                      feedEvents,
                      locationCopy.emptyTitle,
                      locationCopy.emptySubtitle,
                      { label: t('discover.changeLocation'), onAction: () => setWhereSheetOpen(true) },
                      MapPin,
                    )}

                <ElsewhereRail
                  events={elsewhere}
                  metro={activeMetro}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                />
              </>
            )}

            {discoverTab === 'following' && (
              <EmptyState
                icon={Users}
                title={t('discover.following.emptyTitle')}
                subtitle={t('discover.following.emptySubtitle')}
                actionLabel={t('discover.following.syncContacts')}
                onAction={() => navigation.navigate('Connections', { autoSync: true })}
              />
            )}

            {discoverTab === 'saved' &&
              renderFeed(savedEvents, t('discover.saved.emptyTitle'), t('discover.saved.emptySubtitle'))}
          </>
        )}
      </ScrollView>

      <EventFiltersSheet />

      {/* The one way another market appears: the user changes location. */}
      <LocationPickerSheet
        visible={whereSheetOpen}
        onClose={() => setWhereSheetOpen(false)}
        selectedCity={activeCity}
        onSelect={(city) => {
          setActiveCity(city);
          setWhereSheetOpen(false);
        }}
      />

      <WhenPickerSheet
        visible={whenSheetOpen}
        onClose={() => setWhenSheetOpen(false)}
        value={selectedDate}
        onSelect={(v, picked) => {
          setSelectedDate(v);
          setPickedDate(picked);
        }}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // The feed fills the whole screen (behind the absolute header) so posters
  // scroll up under the translucent header.
  contentUnderHeader: {
    flex: 1,
  },
  ambientImg: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
    opacity: 0.45,
    resizeMode: 'cover',
  },
  header: {
    // Absolute FULLY-TRANSPARENT overlay (no scrim box): the feed scrolls UP
    // behind it so the poster shows cleanly through behind the search + tabs.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  // Very subtle top-only gradient — just enough contrast for legibility on
  // bright posters, fading to fully transparent (no box, no frosted panel).
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
  },
  // Collapsed header: a compact search + filter icon row pinned to the top,
  // shown when the feed is scrolled down for maximum poster visibility.
  collapsedRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Active-location chip above the search pill (matches Home's header chip).
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingBottom: 8,
  },
  locationText: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    maxWidth: 200,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Active-filter COUNT badge on the round filter button (replaces the bare dot).
  filterCountBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  filterCountText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
  },
  // Smaller, tighter segment tabs (POSH — compact, understated).
  tabsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    paddingTop: 12,
    paddingBottom: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: colors.textTertiary,
  },
  tabTextActive: {
    color: colors.text,
  },
  feedContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
});
