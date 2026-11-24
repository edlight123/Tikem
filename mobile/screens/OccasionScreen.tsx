import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarDays, CalendarX, ChevronLeft, Plus } from 'lucide-react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import { isVisibleOnExplore } from '../lib/api/events';
import { isEventOver } from '../lib/homeFeeds';
import { collapseSeries } from '../lib/eventSeries';
import { eventCountry } from '../data/metros';
import { formatDateForLanguage } from '../lib/dates';
import { photoByKey } from '../lib/photoLibrary';
import { WORLD_PHOTOS, type ArtPiece } from '../lib/artLibrary';
import {
  ideaDate,
  ideaText,
  occasionBlurb,
  occasionByKey,
  occasionDaysUntil,
  occasionEvents,
  occasionIdeas,
  occasionName,
  occasionToday,
  occasionWindow,
  parseOccasion,
  type OccasionKey,
} from '../lib/occasions';
import PosterEventCard from '../components/PosterEventCard';
import SectionHeader from '../components/SectionHeader';
import EmptyState from '../components/EmptyState';
import WhitePillCTA from '../components/WhitePillCTA';
import OccasionIcon from '../components/OccasionIcon';
import { GridSkeleton } from '../components/Skeleton';
import { ListGroup, ListRow } from '../components/ui';
import { withAlpha, font, radius } from '../theme/tokens';
import { API_BASE_URL } from '../lib/api/backend';
import { loadHolidayTemplates, posterQuery, holidaySpec, type HolidayTemplate } from '../components/organizer/PosterTemplateSheet';

/**
 * An occasion's page (lib/occasions: Kanaval, Fèt Manman…). Opened from Home's
 * occasion row, an event's occasion line, tikem://occasions/<key> and the
 * https://www.tikem.co/occasions/<key> universal link. A real photo under the
 * status bar with the countdown, name and dates on it; the occasion's line and
 * "Add an event"; its events in the poster grid (tagged ones, plus untagged
 * ones on the main days of a short occasion); and a few ideas that open
 * Create Event filled in (with the poster an idea names already applied), and
 * a strip of the occasion's holiday posters, each opening Create Event with
 * that poster. Mirrors the website's app/occasions/[key].
 */

const COLUMN_WIDTH = (Dimensions.get('window').width - 32 - 12) / 2;

/** The occasion's photo: a photo-library key, else a world photo ("photo-<world>"). */
function occasionPhoto(key: OccasionKey): ArtPiece | undefined {
  const k = occasionByKey(key)!.photo;
  return photoByKey(k) ?? Object.values(WORLD_PHOTOS).find((p) => p.key === k);
}

/** A YYYY-MM-DD day as a local date (no zone shift), for date-fns. */
const localDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export default function OccasionScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t, language } = useI18n();
  const { userCountry, countryResolved } = useFilters();
  const blockedOrganizers = useBlockedOrganizers();

  const key = parseOccasion(route.params?.key);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [posters, setPosters] = useState<HolidayTemplate[]>([]);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    loadHolidayTemplates()
      .then((all) => alive && setPosters(all.filter((h) => h.occasion === key)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);

  const now = Date.now();
  const range = key ? occasionWindow(key, now) : null;

  useEffect(() => {
    if (!key || !range || !countryResolved) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        // The browsing country, like every list: an occasion page is browsing too.
        const country = (userCountry || 'HT').toUpperCase();
        const snap = await getDocs(query(collection(db, 'events'), where('country', '==', country)));
        const at = new Date();
        const rows = snap.docs
          .map((d) => {
            const data: any = d.data();
            const s = data.start_datetime?.toDate ? data.start_datetime.toDate() : data.start_datetime ? new Date(data.start_datetime) : null;
            return { id: d.id, ...data, start_datetime: s };
          })
          // The same gates as every other list: published, not over, not
          // rejected or unlisted, not from a blocked organizer, in the country.
          .filter((e: any) => e.start_datetime && e.is_published !== false && !isEventOver(e, at))
          .filter((e: any) => e.rejected !== true && isVisibleOnExplore(e))
          .filter((e: any) => !(e.organizer_id && blockedOrganizers.has(String(e.organizer_id))))
          .filter((e: any) => eventCountry(e) === userCountry);
        if (alive) setEvents(collapseSeries(occasionEvents(rows, key, range)));
      } catch (err) {
        console.error('Failed to load occasion events', err);
        if (alive) setEvents([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // range is derived from key and the day; key covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userCountry, countryResolved, blockedOrganizers]);

  if (!key || !range) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 56 }]}>
        <TouchableOpacity style={[styles.back, { top: insets.top + 6 }]} onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <EmptyState icon={CalendarX} title={t('occasions.notFound')} />
      </View>
    );
  }

  const occasion = occasionByKey(key)!;
  const name = occasionName(key, language);
  const today = occasionToday(now);
  const underWay = today >= range.start && today <= range.end;
  const days = occasionDaysUntil(range, now);
  const countdown = underWay ? t('occasions.underWay') : days === 1 ? t('occasions.tomorrow') : t('occasions.inDays', { count: days });
  const fmt = (iso: string, withYear: boolean) =>
    formatDateForLanguage(localDay(iso), withYear ? 'MMMM d, yyyy' : language === 'en' ? 'MMMM d' : 'd MMMM', language);
  const sameYear = range.mainStart.slice(0, 4) === range.mainEnd.slice(0, 4);
  const when = range.mainStart === range.mainEnd ? fmt(range.mainStart, true) : `${fmt(range.mainStart, !sameYear)} – ${fmt(range.mainEnd, true)}`;
  const preKanaval = key === 'kanaval' && range.start < range.mainStart ? t('occasions.preKanaval', { date: fmt(range.start, false) }) : '';
  const ideas = occasionIdeas(key);
  const heroH = Math.round(Math.min(width * 1.05, 460)) + insets.top;
  const photo = occasionPhoto(key);
  const addEvent = (idea?: string) => navigation.navigate('CreateEvent', idea ? { occasion: key, idea } : { occasion: key });
  const lang = (['en', 'fr', 'ht'].includes(language) ? language : 'en') as 'en' | 'fr' | 'ht';
  // Each poster drawn with its own suggested title on the occasion's next main day.
  const posterSrc = (h: HolidayTemplate) =>
    `${API_BASE_URL}/api/posters/preview?${posterQuery(
      { title: h.title[lang], date: range.mainStart < today ? range.mainEnd : range.mainStart, time: h.time },
      holidaySpec(h),
      language,
    )}`;
  const posterW = Math.round((width - 32 - 24) / 2.6);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* Full-bleed photo under the status bar; the words on its foot. */}
        <View style={[styles.hero, { height: heroH }]}>
          {photo && (
            <Image source={photo.source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          )}
          <LinearGradient
            colors={[withAlpha('#000000', 0.45), withAlpha('#000000', 0.05), withAlpha('#000000', 0.55), colors.background]}
            locations={[0, 0.3, 0.68, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.heroText}>
            <View style={styles.countdownRow}>
              <View style={[styles.dot, { backgroundColor: underWay ? colors.primary : colors.textSecondary }]} />
              <Text style={styles.countdown}>{countdown}</Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={2} accessibilityRole="header">
              {name}
            </Text>
            <View style={styles.whenRow}>
              <CalendarDays size={14} color={colors.textSecondary} />
              <Text style={styles.whenText}>{when}</Text>
            </View>
            {!!preKanaval && <Text style={styles.preText}>{preKanaval}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.blurbRow}>
            <OccasionIcon name={occasion.icon} color={colors.textTertiary} />
            <Text style={styles.blurb}>{occasionBlurb(key, language)}</Text>
          </View>
          <WhitePillCTA
            label={t('occasions.addEvent')}
            onPress={() => addEvent()}
            size="sm"
            icon={<Plus size={16} color="#000000" strokeWidth={2.2} />}
            style={styles.cta}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('occasions.eventsTitle')} />
          {loading ? (
            // The section already pads 16 and the real grid adds no top pad:
            // the skeleton's own gutter squeezed two fixed-width columns into
            // one, so it showed a single column of posters.
            <View style={{ marginHorizontal: -16 }}>
              <GridSkeleton topPad={0} count={4} />
            </View>
          ) : events.length > 0 ? (
            <View style={styles.grid}>
              {events.map((e) => (
                <PosterEventCard key={e.id} event={e} width={COLUMN_WIDTH} onPress={() => navigation.navigate('EventDetail', { eventId: e.id })} />
              ))}
            </View>
          ) : (
            <EmptyState variant="panel" icon={CalendarDays} title={t('occasions.emptyTitle')} subtitle={t('occasions.emptyBody')} />
          )}
        </View>

        {posters.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={t('occasions.postersTitle')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.posterRow} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
              {posters.map((h) => (
                <TouchableOpacity
                  key={h.id}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('CreateEvent', { occasion: key, holiday: h.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.title[lang]}, ${t('occasions.useIdea')}`}
                  style={[styles.poster, { width: posterW }]}
                >
                  <Image source={{ uri: posterSrc(h) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {ideas.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={t('occasions.ideasTitle')} />
            <ListGroup inset={16}>
              {ideas.map((idea) => {
                const copy = ideaText(idea, language);
                return (
                  <ListRow
                    key={idea.id}
                    title={copy.title}
                    subtitle={`${fmt(ideaDate(idea, now), false)} · ${idea.time}`}
                    onPress={() => addEvent(idea.id)}
                    accessibilityLabel={`${copy.title}, ${t('occasions.useIdea')}`}
                  />
                );
              })}
            </ListGroup>
          </View>
        )}
      </ScrollView>

      {/* Back over the photo. */}
      <TouchableOpacity
        style={[styles.back, { top: insets.top + 6 }]}
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <ChevronLeft size={26} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: colors.surface },
    heroText: { paddingHorizontal: 16, paddingBottom: 18 },
    countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    countdown: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase', color: colors.textSecondary },
    heroTitle: { fontFamily: font.serif, fontSize: 40, lineHeight: 44, color: colors.text },
    whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    whenText: { fontSize: 15, color: colors.text },
    preText: { marginTop: 4, marginLeft: 20, fontSize: 13, color: colors.textSecondary },
    body: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
    blurbRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    blurb: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.textSecondary },
    cta: { alignSelf: 'flex-start' },
    section: { paddingHorizontal: 16, marginTop: 32 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 24 },
    // Full-bleed strip: cancels the section's side padding, keeps it as inset.
    posterRow: { marginHorizontal: -16 },
    poster: { aspectRatio: 4 / 5, borderRadius: radius.poster, overflow: 'hidden', backgroundColor: colors.surface },
    back: { position: 'absolute', left: 16, zIndex: 10 },
  });
