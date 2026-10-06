import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as T, radius } from '../../theme/tokens';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  getOrganizerEvents,
  getOrganizerStats,
  getTodayEvents,
  OrganizerEvent,
  OrganizerStats,
  TodayEvent,
} from '../../lib/api/organizer';
import { Skeleton } from '../../components/Skeleton';
import StatTriplet from '../../components/StatTriplet';
import StatusChip from '../../components/StatusChip';
import GettingStartedCard from '../../components/organizer/GettingStartedCard';
import ActionTileGrid, { ActionTile } from '../../components/organizer/ActionTileGrid';
import SectionHeader from '../../components/SectionHeader';
import { TikemWordmark } from '../../components/TikemWordmark';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { formatPrice } from '../../lib/currency';

/** How many upcoming events the rail shows before "view all" takes over. */
const UPCOMING_RAIL_MAX = 10;
/** An event with no end time counts as running for this long after it starts. */
const NO_END_RUNNING_MS = 6 * 60 * 60 * 1000;

/**
 * The revenue cell: the largest currency is the figure, any other currency is
 * a caption beneath it. HTG and USD are never added together.
 */
function revenueCell(stats: OrganizerStats | null): { value: string | null; caption?: string } {
  if (!stats) return { value: null };
  const [primary, ...rest] = stats.revenueByCurrency;
  if (!primary) return { value: formatPrice(0, stats.defaultCurrency) };
  return {
    value: formatPrice(primary.amount, primary.currency),
    caption: rest.length
      ? rest.map((r) => `+ ${formatPrice(r.amount, r.currency)}`).join('\n')
      : undefined,
  };
}

export default function OrganizerDashboardScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [allEvents, setAllEvents] = useState<OrganizerEvent[]>([]);
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!userProfile?.id) return;

    try {
      const [eventsData, statsData, organizerEvents] = await Promise.all([
        getTodayEvents(userProfile.id),
        getOrganizerStats(userProfile.id, '7d'),
        getOrganizerEvents(userProfile.id, 200),
      ]);

      setTodayEvents(eventsData);
      setStats(statsData);
      setAllEvents(organizerEvents);
    } catch (error) {
      console.error('Error loading organizer dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reload data when screen comes into focus (e.g., after editing an event)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Upcoming rail: published, not cancelled, starting later than now, and not
  // already shown in the tonight block. Soonest first.
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    const todayIds = new Set(todayEvents.map((e) => e.id));
    return allEvents
      .filter((e) => {
        if (todayIds.has(e.id)) return false;
        if (e.status === 'cancelled' || !e.is_published || (e as any).rejected === true) return false;
        const start = new Date(e.start_datetime).getTime();
        return !isNaN(start) && start > now;
      })
      .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
      .slice(0, UPCOMING_RAIL_MAX);
  }, [allEvents, todayEvents]);

  const displayName =
    userProfile?.organization_name || userProfile?.full_name || t('organizerDashboard.organizerFallback');
  const avatarUri = userProfile?.organization_logo || userProfile?.photo_url || null;
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();

  const greeting = (
    <View style={[styles.greetingRow, { paddingTop: insets.top + 16 }]}>
      <View style={styles.greetingText}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {`${t('organizerDashboard.welcomeBack')},`}
        </Text>
        <Text style={styles.screenTitle} numberOfLines={2}>
          {displayName}
        </Text>
      </View>
      <View style={styles.avatar}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <Text style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>
    </View>
  );

  const quickActions: ActionTile[] = [
    {
      key: 'earnings',
      label: t('organizerDashboard.earnings') || 'Earnings',
      icon: 'cash-outline',
      onPress: () => navigation.navigate('OrganizerEarningsHub'),
    },
    {
      key: 'analytics',
      label: t('organizerDashboard.analytics') || 'Analytics',
      icon: 'bar-chart-outline',
      onPress: () => navigation.navigate('OrganizerAnalytics'),
    },
    {
      key: 'payouts',
      label: t('organizerDashboard.payouts') || 'Payouts',
      icon: 'wallet-outline',
      onPress: () => navigation.navigate('OrganizerPayoutSettings'),
    },
    {
      key: 'refunds',
      label: t('organizerDashboard.refunds') || 'Refunds',
      icon: 'refresh-outline',
      onPress: () => navigation.navigate('OrganizerRefunds'),
    },
    {
      key: 'team',
      label: t('organizerDashboard.team') || 'Team',
      icon: 'people-outline',
      onPress: () => navigation.navigate('OrganizerTeamHub'),
    },
    {
      key: 'scan',
      label: t('tabs.scan') || 'Scan',
      icon: 'qr-code-outline',
      onPress: () => navigation.navigate('Scan'),
    },
    // No Create tile here (per beta feedback): Create already lives in My
    // Events' header button.
  ];

  const renderPoster = (
    id: string,
    uri: string | null | undefined,
    themeSource: any,
    wordmarkSize: number,
  ) =>
    uri ? (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
        recyclingKey={id}
      />
    ) : (
      <>
        <LinearGradient
          colors={resolvePosterTheme(themeSource, id || themeSource?.title, themeSource?.category).colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.posterBrand}>
          <TikemWordmark fontSize={wordmarkSize} />
        </View>
      </>
    );

  const eventTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const renderTonightHero = (event: TodayEvent) => {
    const start = new Date(event.start_datetime).getTime();
    const running = !isNaN(start) && start <= Date.now() && Date.now() < start + NO_END_RUNNING_MS;
    const soldOut = event.capacity > 0 && event.ticketsSold >= event.capacity;
    // Time, then the place when we have one. An empty location used to
    // leave a pin icon with nothing next to it (TestFlight 2026-09-06).
    const meta = [eventTime(event.start_datetime), event.location].filter(Boolean).join(' · ');
    const progress = event.capacity > 0 ? Math.min(1, event.ticketsSold / event.capacity) : 0;

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.heroCard}
        onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
        activeOpacity={0.85}
      >
        <View style={styles.heroPoster}>{renderPoster(event.id, event.posterUri, event, 22)}</View>

        <Text style={styles.heroTitle} numberOfLines={2}>{event.title}</Text>
        {!!meta && <Text style={styles.heroMeta} numberOfLines={1}>{meta}</Text>}

        <View style={styles.heroStatusRow}>
          {soldOut ? (
            <StatusChip status="soldout" label={t('organizerEvents.status.soldOut')} />
          ) : running ? (
            <StatusChip status="live" label={t('organizerDashboard.liveNow')} />
          ) : (
            <StatusChip status="upcoming" label={t('organizerDashboard.onSale')} />
          )}
          <Text style={styles.heroSoldText}>
            {event.capacity > 0
              ? t('organizerDashboard.soldOf', { sold: event.ticketsSold, total: event.capacity })
              : `${event.ticketsSold} ${t('common.sold')}`}
          </Text>
        </View>
        {event.capacity > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        )}
        {event.ticketsCheckedIn > 0 && (
          <Text style={styles.heroCheckedIn}>
            {`${event.ticketsCheckedIn} ${t('organizerDashboard.checkedIn').toLowerCase()}`}
          </Text>
        )}

        {/* Scanning is the day-of job: the screen's one primary action. */}
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={(e) => {
            e.stopPropagation();
            navigation.navigate('TicketScanner', { eventId: event.id });
          }}
        >
          <Ionicons name="qr-code-outline" size={20} color="#000" />
          <Text style={styles.primaryButtonText}>{t('organizerDashboard.openScanner')}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // Further events today (rare): a compact row each, with a secondary scan
  // button so the hero keeps the only primary fill.
  const renderTonightRow = (event: TodayEvent) => {
    const meta = [eventTime(event.start_datetime), event.location].filter(Boolean).join(' · ');
    return (
      <TouchableOpacity
        key={event.id}
        style={styles.tonightRow}
        onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
        activeOpacity={0.85}
      >
        <View style={styles.tonightRowPoster}>{renderPoster(event.id, event.posterUri, event, 12)}</View>
        <View style={styles.tonightRowBody}>
          <Text style={styles.tonightRowTitle} numberOfLines={2}>{event.title}</Text>
          {!!meta && <Text style={styles.tonightRowMeta} numberOfLines={1}>{meta}</Text>}
          <Text style={styles.tonightRowMeta} numberOfLines={1}>
            {event.capacity > 0
              ? t('organizerDashboard.soldOf', { sold: event.ticketsSold, total: event.capacity })
              : `${event.ticketsSold} ${t('common.sold')}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.scan')}
          onPress={(e) => {
            e.stopPropagation();
            navigation.navigate('TicketScanner', { eventId: event.id });
          }}
        >
          <Ionicons name="qr-code-outline" size={18} color={colors.text} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {greeting}
        {/* Tonight: a poster-led hero card. */}
        <View style={styles.section}>
          <Skeleton width={110} height={22} radius={7} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={420} radius={radius.xl} />
        </View>
        {/* This week: section title + the metric triplet (••• while loading). */}
        <View style={styles.section}>
          <Skeleton width={120} height={22} radius={7} style={{ marginBottom: 12 }} />
          <StatTriplet
            items={[
              { label: t('organizerDashboard.revenue'), value: null },
              { label: t('organizerDashboard.ticketsSold'), value: null },
              { label: t('organizerDashboard.upcomingEvents'), value: null },
            ]}
          />
        </View>
      </View>
    );
  }

  const [heroEvent, ...moreToday] = todayEvents;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: tabBarSpace + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top}
          />
        }
      >
        {greeting}

        {/* Activation checklist — only renders while steps remain (new organizers). */}
        <GettingStartedCard />

        {/* Tonight: only when something is on today. */}
        {heroEvent && (
          <View style={styles.section}>
            <SectionHeader title={t('organizerDashboard.tonight')} />
            {renderTonightHero(heroEvent)}
            {moreToday.map(renderTonightRow)}
          </View>
        )}

        {/* This week — the POSH metric triplet, numbers on the canvas.
            Revenue is per currency: the largest is the figure, others sit under
            it as a caption (a 25 HTG sale once rendered as "$25.00"). */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerDashboard.thisWeek')} />
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('OrganizerAnalytics')}
          >
            <StatTriplet
              items={[
                { label: t('organizerDashboard.revenue'), ...revenueCell(stats) },
                { label: t('organizerDashboard.ticketsSold'), value: stats ? (stats.ticketsSold || 0) : null },
                { label: t('organizerDashboard.upcomingEvents'), value: stats ? (stats.upcomingEvents || 0) : null },
              ]}
            />
          </TouchableOpacity>
        </View>

        {/* Upcoming: portrait poster rail, hidden when there is nothing ahead. */}
        {upcomingEvents.length > 0 && (
          <View style={styles.railSection}>
            <View style={styles.railHeader}>
              <SectionHeader
                title={t('organizerDashboard.upcoming')}
                onViewAll={() => navigation.navigate('MyEvents')}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.railContent}
            >
              {upcomingEvents.map((event) => {
                const place = event.venue_name || event.city || event.location;
                const meta = [shortDate(event.start_datetime), place].filter(Boolean).join(' · ');
                return (
                  <TouchableOpacity
                    key={event.id}
                    style={styles.railCard}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
                  >
                    <View style={styles.railPoster}>
                      {renderPoster(
                        event.id,
                        event.banner_image_url || event.cover_image_url,
                        event,
                        15,
                      )}
                    </View>
                    <Text style={styles.railTitle} numberOfLines={1}>{event.title}</Text>
                    {!!meta && <Text style={styles.railMeta} numberOfLines={1}>{meta}</Text>}
                    <Text style={styles.railSold} numberOfLines={1}>
                      {`${event.tickets_sold || 0} ${t('common.sold')}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Manage */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerDashboard.manage')} />
          <ActionTileGrid tiles={quickActions} variant="stacked" columns={2} />
        </View>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flex: 1,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 16,
  },
  greetingText: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  // A true circle: avatars keep the round shape.
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  // Tonight hero: filled surface, big 4:5 poster, text below it.
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 14,
  },
  heroPoster: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.xl - 6,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  posterBrand: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    paddingHorizontal: 8,
  },
  heroTitle: {
    marginTop: 16,
    paddingHorizontal: 4,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
  },
  heroMeta: {
    marginTop: 6,
    paddingHorizontal: 4,
    fontSize: 15,
    color: colors.textSecondary,
  },
  heroStatusRow: {
    marginTop: 16,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroSoldText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  progressTrack: {
    marginTop: 10,
    marginHorizontal: 4,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  heroCheckedIn: {
    marginTop: 8,
    paddingHorizontal: 4,
    fontSize: 13,
    color: T.textTertiary,
  },
  primaryButton: {
    marginTop: 18,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.button,
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '700',
  },
  tonightRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
  },
  tonightRowPoster: {
    width: 64,
    aspectRatio: 4 / 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  tonightRowBody: {
    flex: 1,
    gap: 3,
  },
  tonightRowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  tonightRowMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  secondaryButton: {
    width: 48,
    height: 48,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rail: header keeps the gutter, the scroller bleeds to the edge.
  railSection: {
    paddingTop: 20,
    paddingBottom: 4,
  },
  railHeader: {
    paddingHorizontal: 20,
  },
  railContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  railCard: {
    width: 170,
  },
  railPoster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  railTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  railMeta: {
    marginTop: 3,
    fontSize: 14,
    color: colors.textSecondary,
  },
  railSold: {
    marginTop: 3,
    fontSize: 13,
    color: T.textTertiary,
  },
});
