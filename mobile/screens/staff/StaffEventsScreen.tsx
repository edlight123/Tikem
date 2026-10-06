import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ticket, LogIn, ScanLine } from 'lucide-react-native';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { auth } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useStaffEvents, type StaffEventSummary } from '../../hooks/useStaffEvents';
import { safeFormatForLanguage } from '../../lib/dates';
import { radius } from '../../theme/tokens';
import StaffEventCard from '../../components/organizer/StaffEventCard';
import SectionHeader from '../../components/SectionHeader';
import { Skeleton } from '../../components/Skeleton';

/** Firestore Timestamp | {seconds} | ISO string | Date → Date (or null). */
function toDate(value: any): Date | null {
  if (!value) return null;
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else if (typeof value?.seconds === 'number') d = new Date(value.seconds * 1000);
  else d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function posterOf(item: StaffEventSummary): string | null {
  return item.banner_image_url || item.cover_image_url || null;
}

export default function StaffEventsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const { t, language } = useI18n();

  const { events, loading, refreshing, error, refresh } = useStaffEvents();
  const uid = auth.currentUser?.uid || null;

  const emptyText = useMemo(() => {
    if (!uid) return t('staffEvents.signIn');
    return t('staffEvents.noAssigned');
  }, [uid, t]);

  const openScanner = (eventId: string) =>
    (navigation as any).navigate('TicketScanner', { eventId });

  // Display grouping only: the soonest event from today on is featured, the
  // rest of the upcoming ones follow, past assignments go last.
  const { featured, featuredIsToday, upcoming, past } = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const withDate = events.map((e) => ({ e, d: toDate(e.start_datetime) }));
    const up = withDate
      .filter((x) => !x.d || x.d.getTime() >= startOfToday)
      .sort((a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity));
    const done = withDate
      .filter((x) => x.d && x.d.getTime() < startOfToday)
      .sort((a, b) => (b.d as Date).getTime() - (a.d as Date).getTime());
    const first = up[0];
    return {
      featured: first?.e ?? null,
      featuredIsToday: !!(first?.d && isSameDay(first.d, now)),
      upcoming: up.slice(1).map((x) => x.e),
      past: done.map((x) => x.e),
    };
  }, [events]);

  const dateLine = (item: StaffEventSummary) =>
    safeFormatForLanguage(toDate(item.start_datetime), 'EEE, MMM d · h:mm a', language);

  const placeLine = (item: StaffEventSummary) =>
    `${item.venue_name ? item.venue_name : t('common.venue')}${item.city ? `, ${item.city}` : ''}`;

  const renderRow = (item: StaffEventSummary) => {
    const date = dateLine(item);
    return (
      <StaffEventCard
        key={item.id}
        variant="surface"
        title={item.title}
        subtitle={[date, placeLine(item)].filter(Boolean).join(' · ')}
        posterUri={posterOf(item)}
        onPress={() => openScanner(item.id)}
      />
    );
  };

  const renderFeatured = (item: StaffEventSummary) => {
    const poster = posterOf(item);
    const meta = [dateLine(item), placeLine(item)].filter(Boolean).join(' · ');
    return (
      <View style={styles.featured}>
        {!!poster && (
          <Image
            source={{ uri: poster }}
            style={styles.featuredPoster}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={poster}
          />
        )}
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {!!meta && (
          <Text style={styles.featuredMeta} numberOfLines={2}>
            {meta}
          </Text>
        )}
        <TouchableOpacity
          style={styles.primary}
          onPress={() => openScanner(item.id)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('staffEvents.openScanner')}
        >
          <ScanLine size={20} color="#000000" strokeWidth={2} />
          <Text style={styles.primaryText}>{t('staffEvents.openScanner')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => {
    const Icon = !uid ? LogIn : Ticket;
    return (
      <View style={styles.empty}>
        <Icon size={40} color={colors.textSecondary} strokeWidth={1.5} />
        <Text style={styles.emptyTitle}>{emptyText}</Text>
        {!!uid && !error && (
          <Text style={styles.emptyBody}>{t('staffEvents.noAssignedBody')}</Text>
        )}
        {!!uid && error && (
          <TouchableOpacity
            style={[styles.primary, styles.emptyCta]}
            onPress={refresh}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const hasEvents = events.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 20, paddingBottom: 24 + tabBarSpace },
          !hasEvents && styles.contentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textSecondary}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowDot} />
            <Text style={styles.eyebrow}>{t('staffEvents.staffModeTitle').toUpperCase()}</Text>
          </View>
          <Text style={styles.title}>{t('staffEvents.assignedTitle')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {t('staffEvents.assignedSubtitle')}
          </Text>
        </View>

        {loading && !hasEvents ? (
          <View style={styles.loadingList}>
            <Skeleton width="100%" height={420} radius={radius.xl} style={{ marginBottom: 16 }} />
            {[0, 1].map((i) => (
              <Skeleton key={i} width="100%" height={88} radius={radius.lg} style={{ marginBottom: 12 }} />
            ))}
          </View>
        ) : !hasEvents ? (
          renderEmpty()
        ) : (
          <>
            {featured && (
              <View style={styles.section}>
                <SectionHeader
                  title={featuredIsToday ? t('organizerScan.tonight') : t('staffEvents.nextUp')}
                />
                {renderFeatured(featured)}
              </View>
            )}
            {upcoming.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('staffEvents.comingUp')} />
                <View style={styles.rows}>{upcoming.map(renderRow)}</View>
              </View>
            )}
            {past.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('organizerEvents.past')} />
                <View style={styles.rows}>{past.map(renderRow)}</View>
              </View>
            )}
          </>
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
  content: {
    paddingHorizontal: 16,
  },
  contentEmpty: {
    flexGrow: 1,
  },
  header: {
    marginBottom: 8,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  eyebrowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.textSecondary,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    color: colors.textSecondary,
  },
  section: {
    marginTop: 24,
  },
  rows: {
    gap: 12,
  },
  featured: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 16,
  },
  featuredPoster: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    marginBottom: 16,
  },
  featuredTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.text,
  },
  featuredMeta: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  primary: {
    marginTop: 20,
    height: 56,
    borderRadius: radius.button,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
  },
  loadingList: {
    marginTop: 24,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 56,
  },
  emptyTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  emptyCta: {
    alignSelf: 'stretch',
    marginTop: 24,
  },
});
