import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../hooks/useTabBarSpace';
import { filterExploreEvents } from '../lib/api/events';
import { fetchPublishedEventsForCountry } from '../lib/api/eventFeed';
import { filterBlockedEvents, useBlockedOrganizers } from '../lib/blockedOrganizers';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveLocationCopy } from '../lib/locationCopy';
import { MapPin, ChevronDown, CloudOff } from 'lucide-react-native';
import LocationDetectionBanner from '../components/LocationDetectionBanner';
import LocationPickerSheet from '../components/LocationPickerSheet';
import ElsewhereRail from '../components/ElsewhereRail';
import { elsewhereEvents, isEventInMetro } from '../data/metros';

import { TikemWordmark } from '../components/TikemWordmark';
import TrendingSection from '../components/TrendingSection';
import ThisWeekSection from '../components/ThisWeekSection';
import AllEventsPreview from '../components/AllEventsPreview';
import EventRail from '../components/EventRail';
import EmptyState from '../components/EmptyState';
import { HomeFeedSkeleton } from '../components/Skeleton';
import ChromeBlur from '../components/ChromeBlur';
import { isBudgetFriendlyTicketPrice } from '../lib/pricing';
import { isEventOver, type HomeFeed } from '../lib/homeFeeds';
import { getCategoryLabel } from '../lib/categories';
import { shareEvent } from '../lib/share';

// Tolerant city matching (accents/case/"City, ST") so the Near You rail lines up
// with whatever string is stored on each event's `city`.
const normalizeCity = (s: any): string =>
  (s ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const cityMatches = (eventCity: any, target: string): boolean => {
  const e = normalizeCity(eventCity);
  const full = normalizeCity(target);
  if (!e || !full) return false;
  const short = normalizeCity(target.split(',')[0]);
  return e === full || e === short || e.includes(short) || short.includes(e);
};

const toMillis = (v: any): number => {
  if (!v) return 0;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (v?.seconds) return v.seconds * 1000;
  const d = new Date(v).getTime();
  return Number.isFinite(d) ? d : 0;
};

export default function HomeScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const { userCountry, countryResolved, activeCity, activeMetro, setActiveCity } = useFilters();
  // Blocked organizers' events never reach the feed; a change re-runs the fetch.
  const blockedOrganizers = useBlockedOrganizers();
  const locationCopy = useActiveLocationCopy();
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [events, setEvents] = useState<any[]>([]);
  const [featuredEvents, setFeaturedEvents] = useState<any[]>([]);
  const [trendingEvents, setTrendingEvents] = useState<any[]>([]);
  const [thisWeekEvents, setThisWeekEvents] = useState<any[]>([]);
  const [forYouEvents, setForYouEvents] = useState<any[]>([]);
  const [nearYouEvents, setNearYouEvents] = useState<any[]>([]);
  const [freeEvents, setFreeEvents] = useState<any[]>([]);
  const [newEvents, setNewEvents] = useState<any[]>([]);
  const [categoryRails, setCategoryRails] = useState<{ category: string; events: any[] }[]>([]);
  // Top events from OTHER metros in the same country/region — its own rail,
  // below everything local, never mixed into the feed above.
  const [elsewhere, setElsewhere] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // 0 -> 1 over 220ms when the first load lands. Without it the swap from
  // skeleton to content was a single-frame hard cut (measured on a tester's
  // screen recording), which combined with any layout delta reads as the
  // page "sliding in" rather than the placeholders becoming the posters.
  const contentFade = useRef(new Animated.Value(0)).current;
  const skeletonFade = useRef(new Animated.Value(1)).current;
  // Keeps the skeleton MOUNTED (fading out, on top) while the content fades
  // in beneath it. Unmounting it the instant loading ended left a black gap
  // for the fade's duration — visible in the tester's second recording.
  const [skeletonVisible, setSkeletonVisible] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const scrollViewRef = React.useRef<ScrollView>(null);

  // Seeded with a close estimate of the header's height (safe-area + 10pt
  // padding + 33pt wordmark line + 12pt bottom padding) instead of 0: starting
  // at 0 painted the skeleton UNDER the floating header for the first frames,
  // then jumped it down when onLayout reported the real height — the visible
  // "page slides in" a tester reported. onLayout still corrects the estimate.
  const headerSpacerHeight = useRef(new Animated.Value(insets.top + 55)).current;
  const headerHeightRef = useRef(0);
  const lastTabPressRef = useRef(0);
  // Scroll offset, driven natively (the content fade already runs on the
  // native driver, so this must too). It feeds the header's solid-black
  // underlay: fully opaque at rest, fading to the translucent chrome as
  // content actually slides beneath the bar.
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerRestOpacity = scrollY.interpolate({
    inputRange: [0, 24],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const fetchEvents = async () => {
    // The country is a query predicate now, so a fetch before it hydrates would
    // pull the WRONG market (a Haiti phone in English (US) reports "US"). Pull
    // to refresh / double tab press can fire early, so guard here too, not only
    // in the mount effect.
    if (!countryResolved) {
      setRefreshing(false);
      return;
    }
    setError(false);
    try {
      // Published events IN THE ACTIVE COUNTRY. The country is part of the
      // QUERY, not a device-side filter: with `limit(50)` and no location
      // predicate the 50 rows were a location-blind sample of the whole
      // catalogue, so a Miami user could download 50 Haitian events, filter to
      // Miami, match none, and be told Miami is empty while Miami events sat
      // unfetched. Metro narrowing below stays client-side — inside one country
      // the sample is a real sample. See lib/api/eventFeed.ts.
      const eventsData: any[] = await fetchPublishedEventsForCountry(userCountry);

      // Sort client-side so the query needs no ORDERED composite index (the
      // equality-only is_published + country index is enough).
      eventsData.sort((a: any, b: any) => {
        const aTime = a?.start_datetime ? new Date(a.start_datetime).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b?.start_datetime ? new Date(b.start_datetime).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });

      // Hide moderator-rejected events (client-side so we don't need a new
      // composite index). Missing field = not rejected, so existing events show.
      const notRejected = eventsData.filter((e: any) => e.rejected !== true);

      // Hide events the organizer marked as not shown on Explore (unlisted).
      // Missing field = visible, so existing events are unaffected.
      // …and events from organizers this user blocked (App Store 1.2).
      const exploreEvents = filterBlockedEvents(filterExploreEvents(notRejected), blockedOrganizers);

      // Filter out past events (be lenient - show events from past week that could be ongoing)
      const now = new Date();
      // One shared rule (lib/homeFeeds) so Home and the section pages agree on
      // what "over" means. The previous logic kept an event with no end time
      // visible for a WEEK after it started — a tester rightly asked why a
      // finished event was still on the home feed.
      const futureEvents: any[] = exploreEvents.filter((e) => !isEventOver(e, now));

      // NO fallback to the unfiltered list. It used to show every event —
      // including finished ones — whenever nothing upcoming remained, which
      // turned an empty feed into a feed of stale events. An honest empty
      // state is better than a wrong one.
      const effectiveEvents = futureEvents;
      
      // ONE active location scopes the whole feed: the user's country, then —
      // when they have chosen a town — that town's METRO (Pétion-Ville counts as
      // Port-au-Prince; Fort Lauderdale counts as Miami; Cap-Haïtien does not).
      //
      // NO fallback to the unscoped list. `countryFiltered.length > 0 ? … : all`
      // used to hand a Miami user the whole world the moment Miami was quiet.
      // The empty state below names the location instead, and the one labelled
      // "elsewhere in …" rail is the only cross-metro content on the page.
      // The query already scoped to `userCountry`; this re-check is a cheap
      // guard against a fetch that resolves after the user switched country.
      const countryFiltered = effectiveEvents.filter((e) => (e.country || 'HT') === userCountry);
      const finalEvents = activeMetro
        ? countryFiltered.filter((e) => isEventInMetro(e, activeMetro))
        : countryFiltered;

      console.log(
        '[HomeScreen] Scoped to',
        activeMetro?.label || userCountry,
        '→',
        finalEvents.length,
        'of',
        effectiveEvents.length
      );
      setEvents(finalEvents);

      // Same country (or region), other metros. Built from the country list, so
      // it can never leak another country in.
      setElsewhere(
        elsewhereEvents(countryFiltered, activeMetro).sort(
          (a: any, b: any) => (b.tickets_sold || 0) - (a.tickets_sold || 0)
        )
      );

      // Featured events (top 5 by tickets sold)
      const featured = [...finalEvents]
        .sort((a: any, b: any) => (b.tickets_sold || 0) - (a.tickets_sold || 0))
        .slice(0, 5);
      setFeaturedEvents(featured);

      // Trending events (tickets_sold > 10)
      const trending = finalEvents
        .filter((e) => (e.tickets_sold || 0) > 10)
        .slice(0, 6);
      setTrendingEvents(trending);

      // This week events
      const oneWeekFromNow = new Date(now);
      oneWeekFromNow.setDate(now.getDate() + 7);
      const thisWeek = finalEvents
        .filter((e) => e.start_datetime <= oneWeekFromNow)
        .slice(0, 6);
      setThisWeekEvents(thisWeek);

      // For You — popular picks (most tickets sold), a light personalization proxy.
      const forYou = [...finalEvents]
        .sort((a: any, b: any) => (b.tickets_sold || 0) - (a.tickets_sold || 0))
        .slice(0, 8);
      setForYouEvents(forYou);

      // Near You — events in the exact town, inside the already-scoped metro.
      const nearCity = activeCity;
      const nearYou = nearCity
        ? finalEvents.filter((e) => cityMatches(e.city, nearCity)).slice(0, 8)
        : [];
      setNearYouEvents(nearYou);

      // Free & budget-friendly.
      const free = finalEvents
        .filter((e) => isBudgetFriendlyTicketPrice(e?.ticket_price, e?.currency))
        .slice(0, 8);
      setFreeEvents(free);

      // Just Announced — most recently created events.
      const recentlyAdded = [...finalEvents]
        .sort((a: any, b: any) => toMillis(b.created_at) - toMillis(a.created_at))
        .slice(0, 8);
      setNewEvents(recentlyAdded);

      // One carousel per category that has events.
      const byCategory: Record<string, any[]> = {};
      finalEvents.forEach((e) => {
        const c = e.category;
        if (!c) return;
        (byCategory[c] = byCategory[c] || []).push(e);
      });
      const catRails = Object.keys(byCategory)
        .map((c) => ({ category: c, events: byCategory[c].slice(0, 10) }))
        .filter((r) => r.events.length > 0);
      setCategoryRails(catRails);
    } catch (err) {
      console.error('Error fetching events:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleShare = (event: any) => shareEvent(event, language);

  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(contentFade, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(skeletonFade, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setSkeletonVisible(false);
      });
    }
  }, [loading, contentFade, skeletonFade]);

  useEffect(() => {
    // Hold the first fetch (skeletons stay up) until the country is hydrated
    // (persisted / profile / device locale). Fetching immediately used to run
    // with the locale-guessed country — "US" for phones in Haiti set to
    // English (US) — and paint the wrong rails until the profile loaded.
    if (!countryResolved) return;
    fetchEvents();
    // activeCity is the browse location: changing it must re-scope the feed,
    // and it also feeds the "near you" rail inside fetchEvents.
  }, [userCountry, countryResolved, activeCity, blockedOrganizers]);

  // Active-tab taps: once = scroll to top, twice (quick) = refresh.
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      const navState = navigation.getState();
      const currentRoute = navState.routes[navState.index];
      if (currentRoute.name !== 'Home') return;
      const now = Date.now();
      if (now - lastTabPressRef.current < 400) {
        setRefreshing(true);
        fetchEvents();
      } else {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
      lastTabPressRef.current = now;
    });
    return unsubscribe;
  }, [navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchEvents();
  };


  /**
   * Every rail opens its OWN page now, not Discover. Tapping "view all" on
   * Trending used to drop you into a differently-filtered Discover feed that
   * did not contain the events you had just been scrolling — the tester's
   * complaint. CategoryEvents re-applies the same rule via applyHomeFeed, so
   * the page is exactly the rail without its slice.
   */
  const openFeed = (feed: HomeFeed, title: string, subtitle?: string) =>
    navigation.navigate('CategoryEvents', {
      feed,
      title,
      subtitle,
      city: feed === 'nearYou' ? activeCity : undefined,
    });

  const handleViewAllTrending = () =>
    openFeed('trending', t('home.trendingTitle'), t('home.trendingSubtitle'));

  const handleViewAllThisWeek = () =>
    openFeed('thisWeek', t('home.thisWeekTitle'), t('home.thisWeekSubtitle'));

  const handleViewAllEvents = () => openFeed('all', t('home.allEventsTitle'));

  const handleViewAllForYou = () =>
    openFeed('forYou', t('home.forYouTitle'), t('home.forYouSubtitle'));

  const handleViewAllFree = () => openFeed('free', t('home.freeTitle'), t('home.freeSubtitle'));

  const handleViewAllNew = () => openFeed('new', t('home.newTitle'), t('home.newSubtitle'));

  const handleViewAllNearYou = () =>
    openFeed('nearYou', t('home.nearYouTitle'), t('home.nearYouSubtitle'));

  // Where you are browsing, in words: the metro when we know it, otherwise the
  // chosen town, otherwise the whole country.
  const locationLabel = locationCopy.locationName;

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      
      {/* Location Detection Banner */}
      <LocationDetectionBanner />

      {/* Floating brand + location header */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + 10 },
        ]}
        onLayout={(e) => {
          const h = e?.nativeEvent?.layout?.height ?? 0;
          if (!h) return;
          if (headerHeightRef.current === h) return;
          headerHeightRef.current = h;
          headerSpacerHeight.setValue(h);
        }}
      >
        {/* Blurred chrome, matching the tab bar. Replaces an opaque slab with
            a hairline border. */}
        <ChromeBlur edge="top" />
        {/* Solid canvas underlay on top of the chrome: uniform solid black at
            rest, fading out over the first 24pt of scroll so the blur only
            shows once content is actually underneath the bar. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.background, opacity: headerRestOpacity },
          ]}
        />

        {/* No collapse. Shrinking to a lone "t" and a bare pin left a tall bar
            with two tiny glyphs marooned at either end — it read as broken
            rather than minimal, which is exactly how a tester described it.
            The bar is ~60pt; keeping it whole costs little and always says
            where you are and lets you change it. */}
        <View style={styles.headerLeft}>
          <TikemWordmark fontSize={32} />
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => setLocationSheetOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={locationLabel}
          >
            <MapPin size={13} color={colors.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {locationLabel}
            </Text>
            <ChevronDown size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Animated.ScrollView
        ref={scrollViewRef}
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
      >
        <Animated.View style={{ height: headerSpacerHeight }} />
        {loading ? (
          <HomeFeedSkeleton />
        ) : error && events.length === 0 ? (
          <EmptyState
            icon={CloudOff}
            title={t('common.loadErrorTitle')}
            subtitle={t('common.loadErrorSubtitle')}
            actionLabel={t('common.retry')}
            onAction={onRefresh}
          />
        ) : (
          <View>
            {/* Content fades in while the skeleton (absolute, on top,
                non-interactive) fades out — a real crossfade, no black gap. */}
            <Animated.View style={{ opacity: contentFade }}>
            {/* (Removed the redundant "À l'affiche" masthead per beta feedback —
                the tikèm wordmark in the top bar already brands the screen; the
                section titles below carry the hierarchy.) */}

            {/* For You */}
            {forYouEvents.length > 0 && (
              <View style={styles.firstSection}>
                <EventRail
                  title={t('home.forYouTitle')}
                  subtitle={t('home.forYouSubtitle')}
                  events={forYouEvents}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllForYou}
                />
              </View>
            )}

            {/* Trending Now */}
            {trendingEvents.length > 0 && (
              <View style={styles.section}>
                <TrendingSection
                  events={trendingEvents}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllTrending}
                />
              </View>
            )}

            {/* Near You */}
            {nearYouEvents.length > 0 && (
              <View style={styles.section}>
                <EventRail
                  title={t('home.nearYouTitle')}
                  subtitle={t('home.nearYouSubtitle')}
                  events={nearYouEvents}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllNearYou}
                />
              </View>
            )}

            {/* This Week */}
            {thisWeekEvents.length > 0 && (
              <View style={styles.section}>
                <ThisWeekSection
                  events={thisWeekEvents}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllThisWeek}
                />
              </View>
            )}

            {/* Free & Budget-Friendly */}
            {freeEvents.length > 0 && (
              <View style={styles.section}>
                <EventRail
                  title={t('home.freeTitle')}
                  subtitle={t('home.freeSubtitle')}
                  events={freeEvents}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllFree}
                />
              </View>
            )}

            {/* One carousel per category */}
            {categoryRails.map((rail) => (
              <View key={rail.category} style={styles.section}>
                <EventRail
                  title={getCategoryLabel(t, rail.category)}
                  events={rail.events}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={() => navigation.navigate('CategoryEvents', { category: rail.category, title: getCategoryLabel(t, rail.category) })}
                />
              </View>
            ))}

            {/* Just Announced */}
            {newEvents.length > 0 && (
              <View style={styles.section}>
                <EventRail
                  title={t('home.newTitle')}
                  subtitle={t('home.newSubtitle')}
                  events={newEvents}
                  badge="New"
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllNew}
                />
              </View>
            )}

            {/* The posh-style "discover more" category banners were removed
                per tester feedback (2026-08-29): "this looks too much like
                posh". Category browsing lives in the Discover tab's chips. */}
            {/* All Events Preview */}
            {events.length > 0 && (
              <View style={styles.section}>
                <AllEventsPreview
                  events={events}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                  onViewAll={handleViewAllEvents}
                />
              </View>
            )}

            {events.length === 0 && (
              // Name the place, and offer the one move that changes it. No
              // silent widening — see fetchEvents.
              <EmptyState
                icon={MapPin}
                title={locationCopy.emptyTitle}
                subtitle={locationCopy.emptySubtitle}
                actionLabel={t('discover.changeLocation')}
                onAction={() => setLocationSheetOpen(true)}
              />
            )}

            {/* The ONE labelled cross-metro rail, below every local section.
                Guarded so an absent rail leaves no empty gap. */}
            {elsewhere.length > 0 && (
              <View style={styles.section}>
                <ElsewhereRail
                  events={elsewhere}
                  metro={activeMetro}
                  onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
                />
              </View>
            )}

            {/* Bottom Spacing */}
            <View style={{ height: 32 + tabBarSpace }} />
            </Animated.View>
            {skeletonVisible && (
              <Animated.View
                pointerEvents="none"
                style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: skeletonFade }}
              >
                <HomeFeedSkeleton />
              </Animated.View>
            )}
          </View>
        )}
      </Animated.ScrollView>

      {/* Changing location here changes it everywhere — home, discover,
          categories and search all read the same active location. */}
      <LocationPickerSheet
        visible={locationSheetOpen}
        onClose={() => setLocationSheetOpen(false)}
        selectedCity={activeCity}
        onSelect={(city) => {
          setActiveCity(city);
          setLocationSheetOpen(false);
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
  header: {
    // No backgroundColor and no bottom hairline: ChromeBlur supplies the
    // backdrop, and a border on top of a blur reads as a seam.
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    // No overflow: 'hidden' — it would clip ChromeBlur's below-the-bar fade,
    // which sits at top:'100%', i.e. outside this box. Nothing in the bar needs
    // clipping anyway: the wordmark and the location chip both stay in bounds.
  },
  headerLeft: {
    flex: 1,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    maxWidth: 150,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  firstSection: {
    marginTop: 16,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
});
