import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Search as SearchIcon, X, Building2, User, CloudOff } from 'lucide-react-native';
import { filterExploreEvents } from '../lib/api/events';
import { fetchPublishedEventsForCountry } from '../lib/api/eventFeed';
import { filterBlockedEvents, useBlockedOrganizers } from '../lib/blockedOrganizers';
import { searchUsers, type UserSearchResult } from '../lib/api/social';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { eventCountry, isEventInMetro } from '../data/metros';
import { useActiveLocationCopy } from '../lib/locationCopy';
import { getCategoryLabel } from '../lib/categories';
import { radius } from '../theme/tokens';
import EventListCard from '../components/EventListCard';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import SectionHeader from '../components/SectionHeader';
import VerifiedBadge from '../components/VerifiedBadge';
import { Skeleton, ListSkeleton } from '../components/Skeleton';

interface OrganizerResult {
  id: string;
  name: string;
  verified: boolean;
  photo: string | null;
  count: number;
}

// Accent/case-insensitive match so "leogane" finds "Léogâne" etc.
const normalize = (s: any): string =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * First-load placeholder: the idle screen opens on a "featured events" section
 * header over EventListCard rows, so mirror that shape rather than a bare
 * centred spinner.
 */
function SearchResultsSkeleton() {
  return (
    <View style={{ paddingTop: 16 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <Skeleton width={150} height={22} radius={7} />
      </View>
      <ListSkeleton count={6} />
    </View>
  );
}

export default function SearchScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { userCountry, countryResolved, activeMetro } = useFilters();
  // Blocked organizers' events never reach results; a change re-runs the fetch.
  const blockedOrganizers = useBlockedOrganizers();
  const locationCopy = useActiveLocationCopy();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  // The search bar is a blurred overlay now, so the results beneath reserve its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const inputRef = useRef<TextInput>(null);
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once results have actually scrolled underneath (see OverlayHeader).
  const scrollY = useRef(new Animated.Value(0)).current;

  const [allEvents, setAllEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [people, setPeople] = useState<UserSearchResult[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  // Search is scoped to the active metro. This flips ONLY when the user taps
  // "search all of Haiti" on an empty result — never automatically.
  const [searchWholeCountry, setSearchWholeCountry] = useState(false);

  // The exact same published-events fetch Home and Discover use — one helper, so
  // search can never be looking at a different catalogue than the feed.
  const loadEvents = useCallback(async () => {
    // The country is a QUERY predicate now, so searching before it resolves
    // would search the wrong market. Hold the skeleton until it is hydrated.
    if (!countryResolved) return;
    setLoading(true);
    setError(false);
    try {
      // Country-scoped server-side. The old `limit(50)` with no location
      // predicate made these 50 rows a location-blind sample: past ~50 published
      // events a Miami search could be run against 50 Haitian events and come
      // back empty while Miami events sat unfetched. See lib/api/eventFeed.ts.
      const eventsData = await fetchPublishedEventsForCountry(userCountry);

      // Hide rejected + unlisted events, then future-only (same rules as Discover).
      const notRejected = (eventsData as any[]).filter((e) => e.rejected !== true);
      const exploreEvents = filterBlockedEvents(filterExploreEvents(notRejected), blockedOrganizers);
      const now = new Date();
      const futureEvents = exploreEvents.filter((event) => {
        const start = event.start_datetime ? new Date(event.start_datetime) : null;
        const end = event.end_datetime ? new Date(event.end_datetime) : null;
        const cutoff = end || start;
        if (!cutoff) return false;
        return cutoff >= now;
      });
      setAllEvents(futureEvents.length > 0 ? futureEvents : exploreEvents);
    } catch (err) {
      console.error('[SearchScreen] Error fetching events:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userCountry, countryResolved, blockedOrganizers]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Auto-focus the input on mount (POSH-style dedicated search).
  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timeout);
  }, []);

  const trimmed = queryText.trim();
  const q = normalize(trimmed);

  // Clearing the field ends the widened search too — the next query starts
  // scoped again, so "all of Haiti" never becomes a sticky default.
  useEffect(() => {
    if (!trimmed) setSearchWholeCountry(false);
  }, [trimmed]);



  // The ONE active location scopes search exactly like it scopes browsing:
  // same country, same metro. The only escape is the explicit action below.
  const scopedEvents = useMemo(() => {
    const inCountry = allEvents.filter((e) => eventCountry(e) === userCountry);
    if (searchWholeCountry || !activeMetro) return inCountry;
    return inCountry.filter((e) => isEventInMetro(e, activeMetro));
  }, [allEvents, userCountry, activeMetro, searchWholeCountry]);

  // Featured events: the most-booked upcoming events, shown when idle.
  const featuredEvents = useMemo(
    () =>
      [...scopedEvents]
        .sort((a, b) => (b.tickets_sold || 0) - (a.tickets_sold || 0))
        .slice(0, 8),
    [scopedEvents]
  );

  // Organizers/organizations derived from the loaded events (no new data layer).
  const allOrganizers = useMemo(() => {
    const map = new Map<string, OrganizerResult>();
    for (const e of scopedEvents) {
      const id = e.organizer_id;
      if (!id) continue;
      const name = e.users?.organization_name || e.users?.full_name || e.organizer_name || '';
      if (!name) continue;
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(id, {
          id,
          name,
          verified: !!e.users?.is_verified,
          photo: e.users?.profile_photo_url || e.users?.photo_url || null,
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [scopedEvents]);

  // Match across every field the old Discover feed searched — title, venue,
  // city, category label and description — so venue/neighborhood/category
  // queries surface events, not just title matches.
  const matchedEvents = useMemo(
    () =>
      q
        ? scopedEvents.filter((e) => {
            const haystack = normalize(
              [
                e.title,
                e.venue_name,
                e.city,
                getCategoryLabel(t, e.category),
                e.description,
              ]
                .filter(Boolean)
                .join(' ')
            );
            return haystack.includes(q);
          })
        : [],
    [scopedEvents, q, t]
  );

  const matchedOrganizers = useMemo(
    () => (q ? allOrganizers.filter((o) => normalize(o.name).includes(q)) : []),
    [allOrganizers, q]
  );

  // Live people search (debounced) via the existing backend endpoint.
  useEffect(() => {
    if (trimmed.length < 2) {
      setPeople([]);
      setPeopleLoading(false);
      return;
    }
    let active = true;
    setPeopleLoading(true);
    const handle = setTimeout(async () => {
      try {
        const results = await searchUsers(trimmed);
        if (active) setPeople(results);
      } catch {
        if (active) setPeople([]);
      } finally {
        if (active) setPeopleLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [trimmed]);

  const goEvent = (eventId: string) => {
    Keyboard.dismiss();
    navigation.navigate('EventDetail', { eventId });
  };
  const goProfile = (organizerId: string) => {
    Keyboard.dismiss();
    navigation.navigate('OrganizerProfile', { organizerId });
  };

  const hasQuery = trimmed.length > 0;
  // Offered only when there IS somewhere wider to go: a metro scope in place
  // and the country holding events this search never looked at.
  const canWidenSearch =
    !searchWholeCountry &&
    !!activeMetro &&
    allEvents.some((e) => eventCountry(e) === userCountry && !isEventInMetro(e, activeMetro));
  const scopeLabel = searchWholeCountry
    ? t('search.scopeCountry', { country: locationCopy.countryPhrase })
    : t('search.scopeLocation', { location: locationCopy.locationName });
  const noResults =
    hasQuery &&
    !peopleLoading &&
    matchedEvents.length === 0 &&
    matchedOrganizers.length === 0 &&
    people.length === 0;

  const renderPersonRow = (
    key: string,
    name: string,
    photo: string | null,
    verified: boolean,
    subtitle: string | null,
    Icon: typeof User,
    onPress: () => void
  ) => (
    <TouchableOpacity key={key} style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={styles.avatarFallback}>
          <Icon size={20} color={colors.textSecondary} />
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowNameLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {verified && <VerifiedBadge size="medium" />}
        </View>
        {!!subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    // No paddingTop here: an absolutely-positioned child starts BELOW its
    // parent's padding, so this pushed the chrome under the status bar.
    // OverlayHeader pays the notch inset itself now.
    <View style={styles.container}>
      {/* Header: back + focused search field + clear. */}
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.searchField}>
          <SearchIcon size={18} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={t('discover.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            selectionColor={colors.primary}
            value={queryText}
            onChangeText={setQueryText}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {queryText.length > 0 && (
            <TouchableOpacity onPress={() => setQueryText('')} hitSlop={8}>
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </OverlayHeader>

      {loading ? (
        // No scroll container here — pad the placeholder by hand.
        <View style={{ paddingTop: headerH }}>
          <SearchResultsSkeleton />
        </View>
      ) : error ? (
        <View style={styles.loading}>
          <EmptyState
            icon={CloudOff}
            title={t('common.loadErrorTitle')}
            subtitle={t('common.loadErrorSubtitle')}
            actionLabel={t('common.retry')}
            onAction={loadEvents}
          />
        </View>
      ) : (
        <Animated.ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: headerH, paddingBottom: 32 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
        >
          {noResults ? (
            // Nothing HERE. Say so, and offer the wider search as a deliberate
            // tap — never widen the results on our own.
            <EmptyState
              icon={SearchIcon}
              title={t('search.noResults')}
              subtitle={
                canWidenSearch
                  ? t('search.noResultsInLocation', { location: locationCopy.locationName })
                  : t('search.noResultsSubtitle')
              }
              actionLabel={
                canWidenSearch
                  ? t('search.searchAllCountry', { country: locationCopy.countryPhrase })
                  : undefined
              }
              onAction={canWidenSearch ? () => setSearchWholeCountry(true) : undefined}
            />
          ) : !hasQuery ? (
            // Idle: sensible default — featured upcoming events, in this metro.
            featuredEvents.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('search.featuredEvents')} subtitle={scopeLabel} />
                {featuredEvents.map((event) => (
                  <EventListCard key={event.id} event={event} onPress={() => goEvent(event.id)} />
                ))}
              </View>
            )
          ) : (
            <>
              {matchedEvents.length > 0 && (
                <View style={styles.section}>
                  {/* The subtitle states the scope, so a result list is never
                      ambiguous about which market it is from. */}
                  <SectionHeader title={t('search.events')} subtitle={scopeLabel} />
                  {matchedEvents.map((event) => (
                    <EventListCard key={event.id} event={event} onPress={() => goEvent(event.id)} />
                  ))}
                </View>
              )}

              {matchedOrganizers.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader title={t('search.organizations')} />
                  {matchedOrganizers.map((org) =>
                    renderPersonRow(
                      `org-${org.id}`,
                      org.name,
                      org.photo,
                      org.verified,
                      `${org.count} ${org.count === 1 ? t('search.eventCount') : t('search.eventsCount')}`,
                      Building2,
                      () => goProfile(org.id)
                    )
                  )}
                </View>
              )}

              {(people.length > 0 || peopleLoading) && (
                <View style={styles.section}>
                  <SectionHeader title={t('search.people')} />
                  {peopleLoading && people.length === 0 ? (
                    <ActivityIndicator color={colors.primary} style={styles.inlineLoader} />
                  ) : (
                    people.map((person) =>
                      renderPersonRow(
                        `person-${person.uid}`,
                        person.displayName,
                        person.photoURL || null,
                        !!person.isVerified,
                        null,
                        User,
                        () => goProfile(person.uid)
                      )
                    )
                  )}
                </View>
              )}
            </>
          )}
        </Animated.ScrollView>
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // Overlay chrome (OverlayHeader owns the row layout, the safe-area top
    // padding, the blur backdrop and the absolute placement) — only the row's
    // own geometry is ours. No paddingTop here: `container` carries none, so
    // OverlayHeader's inset is the only one and adding a second would double
    // the gap. No fill and no hairline either: they would paint over the blur.
    header: {
      gap: 10,
      paddingHorizontal: 12,
      paddingBottom: 10,
    },
    backBtn: {
      padding: 4,
    },
    searchField: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      padding: 0,
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
    } as any,
    section: {
      marginTop: 16,
    },
    inlineLoader: {
      alignSelf: 'flex-start',
      marginVertical: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.surfaceMuted,
    },
    avatarFallback: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    rowBody: {
      flex: 1,
    },
    rowNameLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    rowName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    rowSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
      letterSpacing: 0.3,
    },
  });
