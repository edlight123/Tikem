import { collapseSeries } from '../lib/eventSeries';
import React, { useEffect, useRef, useState } from 'react';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import { isVisibleOnExplore } from '../lib/api/events';
import { Animated, View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Touchable } from '../components/ui/Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin } from 'lucide-react-native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import PosterEventCard from '../components/PosterEventCard';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { GridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { getCategoryLabel } from '../lib/categories';
import { applyHomeFeed, isEventOver, type HomeFeed } from '../lib/homeFeeds';
import ElsewhereRail from '../components/ElsewhereRail';
import { elsewhereEvents, eventCountry, isEventInMetro } from '../data/metros';
import { useActiveLocationCopy } from '../lib/locationCopy';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { categoryArt } from '../lib/categoryArt';
import {
  WORLD_PHOTOS,
  artForWorld,
  heroArtForWorld,
  tileArtForCategory,
  worldForCategory,
  worldLabel,
  type WorldKey,
} from '../lib/artLibrary';
import { withAlpha, font } from '../theme/tokens';
import { eventMatchesNationalDay, nationalDayName, resolveNationalDays } from '../lib/nationalDays';
import { nationalDayArt } from '../lib/nationalDaysRemote';
import WhenPickerSheet from '../components/WhenPickerSheet';
import LocationPickerSheet from '../components/LocationPickerSheet';
import PricePickerSheet, { PriceRange } from '../components/PricePickerSheet';
import { getDateRange } from '../utils/filters';
import { CURRENCY_BY_COUNTRY } from '../types/filters';
import { useFilters } from '../contexts/FiltersContext';
import { formatPrice } from '../lib/currency';
import { safeFormatForLanguage } from '../lib/dates';
import type { DateFilter } from '../components/DateChips';
import { NEW_PAGE_MAX, selectNewOnTikem } from '../lib/newOnTikem';

// Fixed column width rather than flex: with an ODD number of events the last
// card in a flex grid stretches to the full row. Matches FavoritesScreen's
// grid and GridSkeleton's FAV_COLUMN_WIDTH so the placeholder and the real
// content line up exactly. 32 = the list's 16pt side padding, 12 = the gutter.
const COLUMN_WIDTH = (Dimensions.get('window').width - 32 - 12) / 2;

// The hero photo for each curated feed: real photos only (WORLD_PHOTOS),
// never the illustrations.
const FEED_PHOTO_WORLD: Record<HomeFeed, WorldKey> = {
  forYou: 'lavi-lannwit',
  trending: 'kilti',
  nearYou: 'gastronomi',
  thisWeek: 'eksperyans',
  free: 'fanmi',
  new: 'mizik',
  all: 'lavi-lannwit',
};

export default function CategoryEventsScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  // `feed` opens one of Home's curated rails as a full page; `category` is the
  // original per-category listing. Exactly one of them is set.
  // `nationalDay` lists the events tagged for a national day (the Home
  // banner's "See events"), under the day's art.
  const { category, feed, city, title, subtitle, world, nationalDay, recent } = route.params || {};
  const nationalDayDef = nationalDay ? resolveNationalDays().find((d) => d.key === nationalDay) ?? null : null;

  // The header floats (OverlayHeader), so the grid reserves its measured height.
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [events, setEvents] = useState<any[]>([]);
  // Top events from OTHER metros in the same country/region — its own labelled
  // rail under the grid, never merged into it.
  const [elsewhere, setElsewhere] = useState<any[]>([]);
  // posh-style filter chips (category pages only). Date and price filter the
  // ALREADY-LOADED list client-side — same rules Discover applies, via the
  // same getDateRange/price helpers, so the two screens can never disagree.
  // The third chip is NOT a filter: it is the app-wide browse location.
  const [dateFilter, setDateFilter] = useState<DateFilter>('any');
  const [pickedDate, setPickedDate] = useState<string | undefined>();
  const [priceRange, setPriceRange] = useState<PriceRange | null>(null);
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [showPricePicker, setShowPricePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const { userCountry, countryResolved, activeCity, activeMetro, setActiveCity } = useFilters();
  // Blocked organizers' events never reach the list; a change re-runs the load.
  const blockedOrganizers = useBlockedOrganizers();
  const locationCopy = useActiveLocationCopy();
  const currencyCode = CURRENCY_BY_COUNTRY[userCountry]?.code || 'HTG';
  const priceCeiling = currencyCode === 'HTG' || currencyCode === 'DOP' ? 10000 : 200;
  const [loading, setLoading] = useState(true);
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once the grid has actually scrolled underneath (see OverlayHeader).
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const load = async () => {
      if (!category && !feed && !world && !nationalDayDef && !recent) {
        setLoading(false);
        return;
      }
      // The country is now part of the query, so wait for the stored/IP-resolved
      // value instead of fetching the default market and correcting after.
      if (!countryResolved) return;
      try {
        setLoading(true);
        // Country is filtered SERVER side: this page has no limit, so without it
        // every "view all" tap downloaded the whole catalogue to throw away the
        // other markets. A feed page still has no feed predicate — its rule is
        // applied client side by applyHomeFeed, the SAME function that builds the
        // Home rail.
        const country = (userCountry || 'HT').toUpperCase();
        const snap = await getDocs(
          category
            ? query(
                collection(db, 'events'),
                where('country', '==', country),
                where('category', '==', category)
              )
            : query(collection(db, 'events'), where('country', '==', country))
        );
        const now = new Date();
        const rows = snap.docs
          .map((d) => {
            const data: any = d.data();
            return {
              id: d.id,
              ...data,
              start_datetime: data.start_datetime?.toDate
                ? data.start_datetime.toDate()
                : data.start_datetime
                ? new Date(data.start_datetime)
                : null,
            };
          })
          // Published + not-yet-over. Uses the same isEventOver rule as Home so
          // a rail and its "view all" page cannot disagree about what has
          // finished; `start >= now` here would have hidden an event that is
          // currently running while Home still showed it.
          .filter((e: any) => e.is_published !== false && !isEventOver(e, now))
          // Same moderation gates as the Home rail this page expands: not
          // rejected, not unlisted / auto-hidden, not from a blocked organizer.
          .filter((e: any) => e.rejected !== true && isVisibleOnExplore(e))
          .filter((e: any) => !(e.organizer_id && blockedOrganizers.has(String(e.organizer_id))))
          .sort(
            (a: any, b: any) => a.start_datetime.getTime() - b.start_datetime.getTime()
          );

        // Same ONE active location as everywhere else: the country, then the
        // metro when a town is chosen. A category page is browsing too, so it
        // cannot be the screen that quietly shows another market.
        const inCountry = rows.filter((e: any) => eventCountry(e) === userCountry);
        const local = activeMetro
          ? inCountry.filter((e: any) => isEventInMetro(e, activeMetro))
          : inCountry;

        // Home's "new on Tikèm" in full: the same rule (lib/newOnTikem) over
        // the same place, a longer cap.
        if (recent) {
          setEvents(selectNewOnTikem(local, { now: now.getTime(), country, max: NEW_PAGE_MAX, min: 1 }));
          setElsewhere([]);
          return;
        }

        // No limit: this IS the "view all" page, so it is the rail's rule
        // without the slice.
        // A world page gathers every category in that world (mizik = Concert +
        // Music…), mapped with the same worldForCategory the tiles use.
        const scoped = world
          ? local.filter((e: any) => worldForCategory(e.category) === world)
          : nationalDayDef
            ? local.filter((e: any) => eventMatchesNationalDay(e, nationalDayDef))
            : local;
        // One card per recurring series (lib/eventSeries).
        setEvents(collapseSeries(feed ? applyHomeFeed(scoped, feed, { city }) : scoped));
        setElsewhere(
          collapseSeries(elsewhereEvents(inCountry, activeMetro)).sort(
            (a: any, b: any) => (b.tickets_sold || 0) - (a.tickets_sold || 0)
          )
        );
      } catch (err) {
        console.error('Failed to load category events', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [category, feed, world, nationalDay, recent, city, userCountry, countryResolved, activeMetro?.id, blockedOrganizers]);

  const { start: dStart, end: dEnd } = getDateRange(dateFilter, pickedDate);
  const visibleEvents = events.filter((e) => {
    if (dStart || dEnd) {
      const d = e.start_datetime ? new Date(e.start_datetime) : null;
      if (!d) return false;
      if (dStart && d < dStart) return false;
      if (dEnd && d > dEnd) return false;
    }
    if (priceRange) {
      const price = Number(e.ticket_price) || 0;
      if (price < priceRange.min) return false;
      // A max at the ceiling means "and up" — no upper bound.
      if (priceRange.max < priceCeiling && price > priceRange.max) return false;
    }
    return true;
  });
  // The location is NOT counted here: an empty page because of where you are
  // needs the "change location" empty state, not "clear your filters".
  const filtersActive = dateFilter !== 'any' || !!priceRange;



  // Chip labels carry their VALUE when active.
  const DATE_LABEL_KEYS: Record<string, string> = {
    today: 'filters.dateOptions.today',
    tomorrow: 'filters.dateOptions.tomorrow',
    'this-week': 'filters.dateOptions.thisWeek',
    'this-weekend': 'filters.dateOptions.thisWeekend',
  };
  const dateChipLabel =
    dateFilter === 'pick-date' && pickedDate
      ? safeFormatForLanguage(new Date(pickedDate + 'T12:00:00'), 'MMM d', language)
      : dateFilter !== 'any'
        ? t(DATE_LABEL_KEYS[dateFilter])
        : t('filters.date');
  const priceChipLabel = priceRange
    ? `${formatPrice(priceRange.min, currencyCode)}–${
        priceRange.max >= priceCeiling ? '+' : formatPrice(priceRange.max, currencyCode)
      }`
    : t('filters.price');

  // Every "view all" page gets posh's treatment: a full-bleed photo hero with
  // "( label )" centered that scrolls away with the grid. Curated feeds ("for
  // you", "this week"…) borrow a world photo (FEED_PHOTO_WORLD) so they match
  // the category pages. The filter chips stay category-only.
  const isCategoryPage = !!category || !!world || !!nationalDayDef;
  const hasHero = isCategoryPage || !!feed;
  // A national-day page opened from the push carries only the key, so the
  // day's own name stands in for the title Home passes.
  const label = (
    title ||
    (nationalDayDef ? nationalDayName(nationalDayDef, language) : '') ||
    (world ? worldLabel(world) : getCategoryLabel(t, category)) ||
    category ||
    ''
  )
    .toString()
    .toLowerCase();
  // The hero wears the category's WORLD photo (lib/artLibrary WORLD_PHOTOS);
  // a category with no world (religious, wellness) keeps its original photo.
  const heroArt = nationalDayDef
    ? nationalDayArt(nationalDayDef)?.source ?? artForWorld('kilti', 'kilti').source
    : world
    ? heroArtForWorld(world).source
    : category
    ? tileArtForCategory(category)?.source ?? categoryArt(category)
    : WORLD_PHOTOS[FEED_PHOTO_WORLD[feed as HomeFeed] ?? 'lavi-lannwit'].source;

  const Hero = hasHero ? (
    <View style={styles.hero}>
      <Image
        source={heroArt}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
      <LinearGradient
        // The screenprints are brighter than the old photos, so the band under
        // the centred name sits a step darker; it still melts into the canvas.
        colors={[withAlpha('#000000', 0.4), withAlpha('#000000', 0.48), colors.background]}
        locations={[0, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroTitleRow}>
        <Text style={styles.heroParen}>(</Text>
        <Text style={styles.heroTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.heroParen}>)</Text>
      </View>
      <TouchableOpacity
        style={[styles.heroBack, { top: insets.top + 6 }]}
        onPress={() => navigation.goBack()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <ChevronLeft size={26} color="#FFF" />
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      {!hasHero && (
      <OverlayHeader onHeight={onHeight} scrollY={scrollY}>
        {/* Fixed 32pt box + extra gap: the 30pt italic serif's 'g' swash leans
            left past its text box and was colliding with the chevron's tap
            square ("blocking part of the g in gratuit"). */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBox}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {label}
          </Text>
          {/* Carries the rail's own subtitle through, so the page reads as the
              same section you tapped rather than an unlabelled list. */}
          {!!subtitle && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </OverlayHeader>
      )}

      {loading ? (
        <View style={{ paddingTop: hasHero ? 0 : headerH + 16 }}>
          {Hero}
          {/* The real list pads the top once (header + 16, or the hero's 16
              margin); the grid skeleton used to add its own 16 on top, and
              had no filter-chip row, so the posters jumped up on load. */}
          <View style={hasHero ? styles.heroGridPad : null}>
            <GridSkeleton topPad={0} chips={isCategoryPage} />
          </View>
        </View>
      ) : (
        <Animated.FlatList
          data={visibleEvents}
          keyExtractor={(item: any) => item.id}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          // A two-column poster grid, NOT a row list. You arrive here from a
          // rail of poster art; landing on plain text rows read as a different
          // product. Same card the rail uses, so the section simply unfolds.
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item }) => (
            <PosterEventCard
              event={item}
              width={COLUMN_WIDTH}
              onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
            />
          )}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {Hero}
              {isCategoryPage && (
                <View style={styles.filterRow}>
                  <Touchable
                    style={[styles.filterChip, dateFilter !== 'any' && styles.filterChipActive]}
                    onPress={() => setShowWhenPicker(true)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.filterChipText, dateFilter !== 'any' && styles.filterChipTextActive]} numberOfLines={1}>
                      {dateChipLabel}
                    </Text>
                  </Touchable>
                  <Touchable
                    style={[styles.filterChip, !!priceRange && styles.filterChipActive]}
                    onPress={() => setShowPricePicker(true)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.filterChipText, !!priceRange && styles.filterChipTextActive]} numberOfLines={1}>
                      {priceChipLabel}
                    </Text>
                  </Touchable>
                  {/* Not a filter — the app-wide browse location. Tapping it
                      moves every screen, which is the only way another market
                      ever appears. */}
                  <Touchable
                    style={[styles.filterChip, !!activeCity && styles.filterChipActive]}
                    onPress={() => setShowLocationPicker(true)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.filterChipText, !!activeCity && styles.filterChipTextActive]} numberOfLines={1}>
                      {activeCity ? locationCopy.locationName : t('filters.location')}
                    </Text>
                  </Touchable>
                </View>
              )}
            </View>
          }
          ListHeaderComponentStyle={hasHero ? styles.heroListHeader : null}
          contentContainerStyle={[
            styles.listContent,
            hasHero
              // The hero pays the top of the page; the grid needs only its gap.
              ? { paddingTop: 0, paddingBottom: 32 + insets.bottom }
              : { paddingTop: headerH + 16, paddingBottom: 32 + insets.bottom },
          ]}
          ListEmptyComponent={
            <EmptyState
              icon={MapPin}
              // The hero already carries the page's photo.
              art={hasHero ? undefined : artForWorld(null, feed || title || '')}
              title={
                filtersActive
                  ? t('filters.noMatchTitle')
                  : locationCopy.emptyTitle
              }
              subtitle={
                filtersActive
                  ? undefined
                  : locationCopy.emptySubtitle
              }
              actionLabel={filtersActive ? undefined : t('discover.changeLocation')}
              onAction={filtersActive ? undefined : () => setShowLocationPicker(true)}
            />
          }
          ListFooterComponent={
            <ElsewhereRail
              events={elsewhere}
              metro={activeMetro}
              onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
            />
          }
        />
      )}
      <WhenPickerSheet
        visible={showWhenPicker}
        onClose={() => setShowWhenPicker(false)}
        value={dateFilter}
        onSelect={(v, picked) => {
          setDateFilter(v);
          setPickedDate(picked);
        }}
      />
      <PricePickerSheet
        visible={showPricePicker}
        onClose={() => setShowPricePicker(false)}
        currencyCode={currencyCode}
        value={priceRange}
        onApply={setPriceRange}
      />
      <LocationPickerSheet
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        selectedCity={activeCity}
        onSelect={(nextCity) => {
          setActiveCity(nextCity);
          setShowLocationPicker(false);
        }}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    backBox: {
      width: 32,
      height: 36,
      alignItems: 'flex-start',
      justifyContent: 'center',
      marginRight: 4,
    },
    headerText: {
      flex: 1,
      paddingLeft: 4,
    },
    headerSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    headerTitle: {
      // Italic, like the tikèm wordmark — the section title is editorial
      // voice, not a system label. Slightly larger to carry the page.
      fontFamily: 'InstrumentSerif_400Regular_Italic',
      fontSize: 30,
      lineHeight: 36,
      color: colors.text,
      letterSpacing: 0.2,
    },
    hero: {
      height: 200,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    heroTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 24,
    },
    heroTitle: {
      fontFamily: 'InstrumentSerif_400Regular_Italic',
      fontSize: 34,
      color: '#FFFFFF',
      maxWidth: '80%',
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 8,
    },
    // posh sets the name inside soft parentheses — quieter than the name.
    heroParen: {
      fontFamily: font.serif,
      fontSize: 32,
      color: 'rgba(255,255,255,0.65)',
    },
    heroBack: {
      position: 'absolute',
      left: 16,
    },
    // Full-bleed: cancel the list's horizontal padding for the header row.
    heroListHeader: {
      marginHorizontal: -16,
      marginBottom: 16,
    },
    heroGridPad: {
      paddingTop: 16,
    },
    // The list header bleeds to the screen edge for the hero (heroListHeader's
    // -16), so the chips put the grid's 16 back or they sit flush on the edge.
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    // Same chip as the website's (discoverChipCls): fill against fill, a faint
    // white wash when off and solid white with black ink when on. The old
    // hairline box read as an empty outline ("this fill doesn't match the
    // website style").
    filterChip: {
      paddingHorizontal: 14,
      height: 36,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
      maxWidth: 150,
    },
    filterChipActive: {
      backgroundColor: colors.white,
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.75)',
    },
    filterChipTextActive: {
      color: colors.background,
    },
    gridRow: {
      gap: 12,
      justifyContent: 'flex-start',
      // The space BETWEEN rows. columnWrapperStyle's gap is horizontal only, so
      // rows used to stack flush: each card's date line touched (and read as cut
      // by) the next row's poster. 24pt lets the three-line caption breathe.
      marginBottom: 24,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 32,
      flexGrow: 1,
    },
  });
