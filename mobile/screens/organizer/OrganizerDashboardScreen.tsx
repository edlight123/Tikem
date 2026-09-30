import React, { useState, useEffect, useCallback } from 'react';
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
import { font, radius } from '../../theme/tokens';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  getOrganizerStats,
  getTodayEvents,
  OrganizerStats,
  TodayEvent,
} from '../../lib/api/organizer';
import { SPACING, RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import GettingStartedCard from '../../components/organizer/GettingStartedCard';
import { Calendar } from 'lucide-react-native';
import SectionHeader from '../../components/SectionHeader';
import { TikemWordmark } from '../../components/TikemWordmark';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { formatPrice } from '../../lib/currency';

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
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!userProfile?.id) return;

    try {
      const [eventsData, statsData] = await Promise.all([
        getTodayEvents(userProfile.id),
        getOrganizerStats(userProfile.id, '7d'),
      ]);

      setTodayEvents(eventsData);
      setStats(statsData);
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

  const headerSubtitle = `${t('organizerDashboard.welcomeBack')}, ${userProfile?.full_name || t('organizerDashboard.organizerFallback')}`;

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('organizerDashboard.title')}
          subtitle={headerSubtitle}
          overlay
          onHeight={onHeight}
        />
        <View style={{ paddingTop: headerH }}>
          {/* Today's Events: section title + one event card (padded surface). */}
          <View style={styles.section}>
            <Skeleton width={150} height={22} radius={7} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={200} radius={RADIUS.lg} />
          </View>
          {/* This Week: section title + the metric triplet (••• while loading). */}
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
          {/* Quick Actions: section title + the 2-col grid of 6 action tiles
              (46 tall = paddingVertical 13×2 + 20 icon). */}
          <View style={styles.section}>
            <Skeleton width={140} height={22} radius={7} style={{ marginBottom: 12 }} />
            <View style={styles.quickActionsGrid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} width="48%" height={46} radius={RADIUS.lg} />
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Fixed Header */}
      <OrganizerScreenHeader
        title={t('organizerDashboard.title')}
        subtitle={headerSubtitle}
        overlay
        onHeight={onHeight}
      />

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: tabBarSpace + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Activation checklist — only renders while steps remain (new organizers). */}
        <GettingStartedCard />

        {/* Today's Events */}
        <View style={styles.section}>
        <SectionHeader title={t('organizerDashboard.todaysEvents')} />
        {todayEvents.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={t('organizerDashboard.noEventsToday')}
            compact
          />
        ) : (
          todayEvents.map((event) => {
            const eventTime = new Date(event.start_datetime).toLocaleTimeString(locale, {
              hour: 'numeric',
              minute: '2-digit',
            });

            // Time, then the place when we have one. An empty location used to
            // leave a pin icon with nothing next to it (TestFlight 2026-09-06).
            const meta = [eventTime, event.location].filter(Boolean).join('  ·  ');

            return (
              <TouchableOpacity
                key={event.id}
                style={styles.eventCard}
                onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
                activeOpacity={0.8}
              >
                <View style={styles.eventRow}>
                  {/* Portrait poster, the same 4:5 thumb My Events uses. */}
                  <View style={styles.eventPoster}>
                    {event.posterUri ? (
                      <Image
                        source={{ uri: event.posterUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                        recyclingKey={event.id}
                      />
                    ) : (
                      <>
                        <LinearGradient
                          colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.eventPosterBrand}>
                          <TikemWordmark fontSize={15} />
                        </View>
                      </>
                    )}
                  </View>

                  <View style={styles.eventBody}>
                    <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
                    <View style={styles.eventMetaRow}>
                      <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                      <Text style={styles.eventMetaText} numberOfLines={1}>{meta}</Text>
                    </View>
                    <StatTriplet
                      columns={2}
                      items={[
                        { label: t('organizerDashboard.ticketsSold'), value: `${event.ticketsSold}/${event.capacity}` },
                        { label: t('organizerDashboard.checkedIn'), value: event.ticketsCheckedIn },
                      ]}
                    />
                  </View>
                </View>

                {/* Scanning is the day-of job, so it gets the primary fill. */}
                <TouchableOpacity
                  style={styles.scanButton}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  onPress={(e) => {
                    e.stopPropagation();
                    navigation.navigate('TicketScanner', { eventId: event.id });
                  }}
                >
                  <Ionicons name="qr-code-outline" size={18} color="#000" />
                  <Text style={styles.scanButtonText}>{t('tabs.scan')}</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* This Week Stats — the reusable POSH metric triplet (§2.3).
          Revenue / Tickets Sold / Upcoming, three across. `null` renders •••
          while loading; zero-states (0 HTG / 0) render with confidence.
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

      {/* Quick Actions */}
      <View style={styles.section}>
        <SectionHeader title={t('organizerDashboard.quickActions') || 'Quick Actions'} />
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity 
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('OrganizerAnalytics')}
          >
            <Ionicons name="bar-chart-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('organizerDashboard.analytics') || 'Analytics'}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('OrganizerRefunds')}
          >
            <Ionicons name="refresh-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('organizerDashboard.refunds') || 'Refunds'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('OrganizerEarningsHub')}
          >
            <Ionicons name="cash-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('organizerDashboard.earnings') || 'Earnings'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('OrganizerPayoutSettings')}
          >
            <Ionicons name="wallet-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('organizerDashboard.payouts') || 'Payouts'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('OrganizerTeamHub')}
          >
            <Ionicons name="people-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('organizerDashboard.team') || 'Team'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionButton}
            onPress={() => navigation.navigate('Scan')}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.text} />
            <Text style={styles.quickActionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t('tabs.scan') || 'Scan'}</Text>
          </TouchableOpacity>
          {/* No Create tile here (per beta feedback): the odd 7th tile broke the
              2-col grid, and Create already lives in My Events' header button. */}
        </View>
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
  // Tighter vertical rhythm so all three sections (Today / This Week / Quick
  // Actions) fit one screen without scrolling (beta feedback).
  section: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  // Filled surface (not a hairline box): poster left, details right, and the
  // Scan action across the bottom.
  eventCard: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 12,
    marginBottom: SPACING.md,
  },
  eventRow: {
    flexDirection: 'row',
    gap: 14,
  },
  eventPoster: {
    width: 96,
    aspectRatio: 4 / 5,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  eventPosterBrand: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    paddingHorizontal: 8,
  },
  eventBody: {
    flex: 1,
    justifyContent: 'space-between',
  },
  eventTitle: {
    fontFamily: font.serif,
    fontSize: 21,
    lineHeight: 25,
    color: colors.text,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  eventMetaText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 5,
    flex: 1,
  },
  scanButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.button,
    paddingVertical: 11,
  },
  scanButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 6,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  quickActionButton: {
    width: '48%',
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: 'center',
    // Left-align icon + label: centering each button's content made the icons
    // land at different x-positions (labels vary in width), so the grid read as
    // misaligned. Flex-start gives every icon a shared left edge.
    justifyContent: 'flex-start',
    flexDirection: 'row',
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginLeft: 10,
    flexShrink: 1,
  },
});
