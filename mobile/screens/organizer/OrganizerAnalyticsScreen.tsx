import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { radius } from '../../theme/tokens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveOrg } from '../../lib/activeOrg';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { backendFetch } from '../../lib/api/backend';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import SectionHeader from '../../components/SectionHeader';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { format, subDays, startOfDay } from 'date-fns';
import { safeFormatForLanguage } from '../../lib/dates';
import { formatCurrency, normalizeCurrency, splitFormattedMoney } from '../../lib/currency';
import {
  CurrencyAmount,
  dominantEventCurrency,
  isCountedSale,
  sumRevenueByCurrency,
  ticketCurrency,
  ticketPurchaseDate,
} from '../../lib/organizerStats';

interface ChartData {
  date: string;
  sales: number;
  revenue: number;
}

interface EventStats {
  id: string;
  title: string;
  ticketCount: number;
  revenueCents: number;
  currency: string;
}

/**
 * The API returns `revenueByCurrency` as a map of currency → major units. Turn
 * it into the same largest-first list the dashboard uses, dropping zeros.
 */
function revenueListFromApi(map: unknown): CurrencyAmount[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map as Record<string, unknown>)
    .map(([code, amount]) => ({ currency: normalizeCurrency(code), amount: Number(amount) || 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

interface AnalyticsStats {
  totalEvents: number;
  publishedEvents: number;
  totalTicketsSold: number;
  totalRevenue: number;
  currency: string;
}

interface AnalyticsResult {
  stats: AnalyticsStats;
  revenueByCurrency: CurrencyAmount[];
  chartData: ChartData[];
  topEvents: EventStats[];
}

type TimeRange = '7d' | '30d' | 'all';

/**
 * Last result per (org, range), in memory for this app session only. Shown
 * instantly on re-open while a fresh load runs underneath (TestFlight #200).
 */
const analyticsCache = new Map<string, AnalyticsResult>();
const cacheKey = (orgId: string | null | undefined, range: TimeRange) => `${orgId || ''}:${range}`;

/** Fallback ticket reads run this many events at a time. */
const FALLBACK_CONCURRENCY = 6;

async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** "12.5K" / "1.2M" so four figures fit on one line; small values stay exact. */
function compactNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(n / 1_000)}K`;
  return Math.round(n).toLocaleString('en-US');
}

/** Money in the compact form, keeping the currency's own symbol placement. */
function compactMoney(amount: number, currency?: string): string {
  const code = normalizeCurrency(currency);
  if (Math.abs(amount) < 10_000) return formatCurrency(amount, code, { decimals: Number.isInteger(amount) ? 0 : 2 });
  const { prefix, suffix } = splitFormattedMoney(formatCurrency(0, code, { decimals: 0 }));
  return `${prefix}${compactNumber(amount)}${suffix}`;
}

export default function OrganizerAnalyticsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { userProfile } = useAuth();
  // Acting org (own or a team's), not the signed-in uid: lib/activeOrg.ts.
  const { orgId } = useActiveOrg();
  const { t, language } = useI18n();
  const { formatMoney: fmtMoney } = useLocaleFormat();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const initial = analyticsCache.get(cacheKey(orgId, '7d'));
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<AnalyticsStats>(
    initial?.stats ?? {
      totalEvents: 0,
      publishedEvents: 0,
      totalTicketsSold: 0,
      totalRevenue: 0,
      currency: normalizeCurrency(null),
    }
  );
  // Revenue per currency, largest first. Never summed across currencies.
  const [revenueByCurrency, setRevenueByCurrency] = useState<CurrencyAmount[]>(initial?.revenueByCurrency ?? []);
  const [chartData, setChartData] = useState<ChartData[]>(initial?.chartData ?? []);
  const [topEvents, setTopEvents] = useState<EventStats[]>(initial?.topEvents ?? []);
  // The (org, range) the screen currently wants; a slower earlier load for
  // another range must not overwrite it.
  const wantedKey = useRef(cacheKey(orgId, timeRange));

  const applyResult = (result: AnalyticsResult) => {
    setStats(result.stats);
    setRevenueByCurrency(result.revenueByCurrency);
    setChartData(result.chartData);
    setTopEvents(result.topEvents);
  };

  useEffect(() => {
    const key = cacheKey(orgId, timeRange);
    wantedKey.current = key;
    const cached = analyticsCache.get(key);
    if (cached) {
      applyResult(cached);
      setLoading(false);
    }
    loadData();
  }, [orgId, timeRange]);

  const loadData = async () => {
    if (!orgId) return;
    const key = cacheKey(orgId, timeRange);

    let result: AnalyticsResult | null = null;
    try {
      // Fetch analytics from the web API (same endpoint the web uses)
      const response = await backendFetch(`/api/organizer/analytics?range=${timeRange}`);

      if (response.ok) {
        const data = await response.json();
        result = {
          stats: {
            totalEvents: data.totalEvents || 0,
            publishedEvents: data.publishedEvents || 0,
            totalTicketsSold: data.totalTicketsSold || 0,
            totalRevenue: data.totalRevenue || 0,
            currency: normalizeCurrency(data.currency),
          },
          // Major units, keyed by every currency that sold (not just USD/HTG).
          revenueByCurrency: revenueListFromApi(data.revenueByCurrency),
          chartData: data.chartData || [],
          topEvents: data.topEvents || [],
        };
      } else {
        // Fallback: Load from Firebase directly
        result = await loadFromFirebase();
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
      result = await loadFromFirebase();
    } finally {
      if (result) analyticsCache.set(key, result);
      if (wantedKey.current === key) {
        if (result) applyResult(result);
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const loadFromFirebase = async (): Promise<AnalyticsResult | null> => {
    try {
      // Calculate the cutoff date based on time range
      const now = new Date();
      let cutoffDate: Date | null = null;
      if (timeRange === '7d') {
        cutoffDate = startOfDay(subDays(now, 7));
      } else if (timeRange === '30d') {
        cutoffDate = startOfDay(subDays(now, 30));
      }
      // 'all' means no cutoff

      // Get organizer events
      const eventsQuery = query(
        collection(db, 'events'),
        where('organizer_id', '==', orgId)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Get tickets for these events
      let totalTickets = 0;
      const soldInRange: any[] = [];
      const eventCurrencyById: Record<string, string | undefined> = {};
      const eventStats: EventStats[] = [];
      const dailySales: Record<string, { sales: number; revenue: number }> = {};

      // Initialize daily sales for chart
      const daysToShow = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 30;
      for (let i = daysToShow - 1; i >= 0; i--) {
        const date = subDays(now, i);
        const dateKey = format(date, 'yyyy-MM-dd');
        dailySales[dateKey] = { sales: 0, revenue: 0 };
      }

      // Every event's tickets at once (a few in flight), not one after another.
      await forEachLimited(events, FALLBACK_CONCURRENCY, async (event) => {
        const eventData = event as any;
        eventCurrencyById[event.id] = eventData.currency;

        const ticketsQuery = query(
          collection(db, 'tickets'),
          where('event_id', '==', event.id)
        );
        const ticketsSnapshot = await getDocs(ticketsQuery);

        let eventTicketCount = 0;
        let eventRevenueCents = 0;
        let eventCurrency = ticketCurrency(null, eventData.currency);

        ticketsSnapshot.docs.forEach(doc => {
          const data = doc.data();

          // Refunded / cancelled / pending tickets are not sales.
          if (!isCountedSale(data.status)) return;

          const purchaseDate = ticketPurchaseDate(data);

          // Filter by time range
          if (cutoffDate && purchaseDate && purchaseDate < cutoffDate) {
            return; // Skip tickets outside the time range
          }

          const pricePaidCents = Math.round((Number(data.price_paid) || 0) * 100);
          eventTicketCount++;
          eventRevenueCents += pricePaidCents;
          eventCurrency = ticketCurrency(data, eventData.currency);
          totalTickets++;
          soldInRange.push({ ...data, event_id: event.id });

          // Track daily sales for chart (the chart plots counts, not money).
          if (purchaseDate) {
            const dateKey = format(purchaseDate, 'yyyy-MM-dd');
            if (dailySales[dateKey]) {
              dailySales[dateKey].sales++;
              dailySales[dateKey].revenue += pricePaidCents / 100;
            }
          }
        });

        if (eventTicketCount > 0) {
          eventStats.push({
            id: event.id,
            title: eventData.title || 'Unknown Event',
            ticketCount: eventTicketCount,
            revenueCents: eventRevenueCents,
            currency: eventCurrency,
          });
        }
      });

      eventStats.sort((a, b) => b.ticketCount - a.ticketCount);

      // Per currency, largest first; the primary is the biggest, or the
      // organizer's usual event currency when nothing sold.
      const revenueRows = sumRevenueByCurrency(soldInRange, eventCurrencyById);
      const primaryCurrency = revenueRows[0]?.currency || dominantEventCurrency(events as any[]);

      const fallbackStats: AnalyticsStats = {
        totalEvents: events.length,
        publishedEvents: events.filter((e: any) => e.is_published).length,
        totalTicketsSold: totalTickets,
        totalRevenue: revenueRows[0]?.amount || 0,
        currency: primaryCurrency,
      };

      // Build chart data
      const chart: ChartData[] = [];
      const sortedDates = Object.keys(dailySales).sort();
      // Show last 7 days for chart regardless of filter
      const chartDates = sortedDates.slice(-7);
      for (const dateKey of chartDates) {
        chart.push({
          date: safeFormatForLanguage(new Date(dateKey), 'MMM dd', language),
          sales: dailySales[dateKey]?.sales || 0,
          revenue: dailySales[dateKey]?.revenue || 0,
        });
      }
      return {
        stats: fallbackStats,
        revenueByCurrency: revenueRows,
        chartData: chart,
        topEvents: eventStats.slice(0, 5),
      };
    } catch (error) {
      console.error('Error loading from Firebase:', error);
      return null;
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Delegate to the shared, currency-aware formatter so HTG renders as a suffixed
  // code (`1,234.56 HTG`) and USD as a prefixed symbol (`$1,234.56`) — never a
  // hardcoded `$`/`G`.
  const formatMoney = (amount: number, currency?: string) =>
    fmtMoney(amount, { currency: normalizeCurrency(currency) });

  // Total revenue: the largest currency is the figure, any other currency is a
  // caption under it ("+ $40"). Currencies are never added together.
  // Compact ("12.5K HTG") so it fits a quarter of the line.
  const totalRevenueCell = () => {
    const [primary, ...rest] = revenueByCurrency;
    if (!primary) return { value: compactMoney(0, stats.currency) };
    return {
      value: compactMoney(primary.amount, primary.currency),
      caption: rest.length
        ? rest.map((r) => `+ ${compactMoney(r.amount, r.currency)}`).join('\n')
        : undefined,
    };
  };

  // Simple bar chart rendering
  const maxSales = Math.max(...chartData.map(d => d.sales), 1);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('analytics.title') || 'Analytics'}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <View style={{ paddingTop: headerH }}>
          {/* Range picker: three SegmentedTabs pills (≈35 tall). */}
          <View style={styles.timeRangeContainer}>
            <View style={styles.timeRangeSkeletonRow}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width={82} height={35} radius={4} />
              ))}
            </View>
          </View>
          {/* Metric line: the real 4-col StatTriplet with ••• placeholders. */}
          <View style={styles.statsWrap}>
            <StatTriplet
              columns={4}
              items={[
                { label: t('analytics.statRevenue'), value: null },
                { label: t('analytics.statSold'), value: null },
                { label: t('analytics.statEvents'), value: null },
                { label: t('analytics.statPublished'), value: null },
              ]}
            />
          </View>
          {/* Sales chart card: title, 120-tall bar area, hairline baseline. */}
          <View style={styles.sectionHead}>
            <Skeleton width={130} height={22} radius={4} style={{ marginBottom: 12 }} />
          </View>
          <View style={styles.chartCard}>
            <View style={styles.chartSkeletonRow}>
              {[46, 78, 60, 100, 34, 88, 52].map((h, i) => (
                <Skeleton key={i} width={24} height={h} radius={4} />
              ))}
            </View>
            <View style={styles.chartBaseline} />
          </View>
          {/* Top events card: title + rank-circle rows. */}
          <View style={styles.sectionHead}>
            <Skeleton width={170} height={22} radius={4} style={{ marginBottom: 12 }} />
          </View>
          <View style={styles.sectionCard}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.eventRow}>
                <Skeleton width={32} height={32} radius={radius.lg} style={{ marginRight: 12 }} />
                <View style={styles.eventInfo}>
                  <Skeleton width="65%" height={15} radius={4} />
                  <Skeleton width="45%" height={13} radius={4} style={{ marginTop: 4 }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <OrganizerScreenHeader
        title={t('analytics.title') || 'Analytics'}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />

      <ScrollView
        style={styles.scrollView}
        // Reserve the floating header's measured height so the range picker
        // isn't born underneath it.
        contentContainerStyle={{ paddingTop: headerH }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Time Range Selector */}
        <View style={styles.timeRangeContainer}>
          <SegmentedTabs
            value={timeRange}
            onChange={(key) => setTimeRange(key as TimeRange)}
            tabs={[
              { key: '7d', label: t('analytics.7days') || '7 Days' },
              { key: '30d', label: t('analytics.30days') || '30 Days' },
              { key: 'all', label: t('analytics.allTime') || 'All Time' },
            ]}
          />
        </View>

        {/* Stats on one line, label over value, like the event analytics
            header (TestFlight #199). Values compact so four fit. */}
        <View style={styles.statsWrap}>
          <StatTriplet
            columns={4}
            items={[
              { label: t('analytics.statRevenue'), ...totalRevenueCell() },
              { label: t('analytics.statSold'), value: compactNumber(stats.totalTicketsSold) },
              { label: t('analytics.statEvents'), value: compactNumber(stats.totalEvents) },
              { label: t('analytics.statPublished'), value: compactNumber(stats.publishedEvents) },
            ]}
          />
        </View>

        {/* Sales Chart */}
        <View style={styles.sectionHead}>
          <SectionHeader title={t('analytics.salesOverTime') || 'Sales Over Time'} />
        </View>
        <View style={styles.chartCard}>
          {chartData.every((d) => (d.sales || 0) === 0) ? (
            <Text style={styles.chartEmpty}>{t('analytics.noSalesInRange') || 'No sales yet in this range'}</Text>
          ) : (
            <View style={styles.chartContainer}>
              {chartData.map((item, index) => {
                const isPeak = item.sales === maxSales && item.sales > 0;
                // Thin x-axis labels when the series is dense (e.g. 30 days).
                const stride = Math.ceil(chartData.length / 8);
                const showLabel = index % stride === 0 || index === chartData.length - 1;
                return (
                  <View key={index} style={styles.chartBarContainer}>
                    {isPeak && <Text style={styles.chartPeakValue}>{item.sales}</Text>}
                    <View style={styles.chartBarWrapper}>
                      <View
                        style={[
                          styles.chartBar,
                          { height: Math.max((item.sales / maxSales) * 100, item.sales > 0 ? 6 : 3) },
                          !isPeak && styles.chartBarDim,
                        ]}
                      />
                    </View>
                    <Text style={styles.chartLabel} numberOfLines={1}>
                      {showLabel ? (item.date.match(/\d+/)?.[0] ?? '') : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          <View style={styles.chartBaseline} />
        </View>

        {/* Derived insights — from already-loaded data, no extra fetch. */}
        {stats.totalEvents > 0 && (
          <View style={styles.statsWrap}>
            <StatTriplet
              columns={2}
              items={[
                {
                  label: t('analytics.bestDay') || 'Best Day',
                  value: (() => {
                    const peak = chartData.reduce(
                      (best, d) => ((d.sales || 0) > (best?.sales || 0) ? d : best),
                      chartData[0]
                    );
                    return peak && (peak.sales || 0) > 0 ? peak.date : '—';
                  })(),
                },
                {
                  label: t('analytics.liveRate') || 'Published',
                  value: stats.totalEvents
                    ? `${Math.round((stats.publishedEvents / stats.totalEvents) * 100)}%`
                    : '—',
                },
              ]}
            />
          </View>
        )}

        {/* Top Events */}
        <View style={styles.sectionHead}>
          <SectionHeader title={t('analytics.topEvents') || 'Top Performing Events'} />
        </View>
        <View style={styles.sectionCard}>
          {topEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>{t('analytics.noData') || 'No ticket sales yet'}</Text>
            </View>
          ) : (
            topEvents.map((event, index) => (
              <Touchable
                key={event.id}
                scale={false}
                pressedColor={colors.surfaceRaised}
                style={[styles.eventRow, index < topEvents.length - 1 && styles.eventRowDivider]}
                onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
              >
                <View style={styles.eventRank}>
                  <Text style={styles.eventRankText}>#{index + 1}</Text>
                </View>
                <View style={styles.eventInfo}>
                  <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                  <Text style={styles.eventStats} numberOfLines={1}>
                    {event.ticketCount} {t('analytics.tickets') || 'tickets'} • {formatMoney(event.revenueCents / 100, event.currency)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Touchable>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  // One consistent vertical beat (14) between blocks — the mixed 16/4/0 margins
  // read as "spacing issues" to testers.
  timeRangeContainer: {
    paddingVertical: 10,
  },
  // SegmentedTabs container row (gap 8, gutter 16, paddingVertical 4).
  timeRangeSkeletonRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  // chartContainer footprint: bars bottom-aligned in the 120-tall band.
  chartSkeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingBottom: 18, // where the real chart's x-axis labels sit
  },
  statsWrap: {
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.xl,
  },
  sectionHead: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
  },
  chartBarContainer: {
    alignItems: 'center',
    flex: 1,
  },
  chartBarWrapper: {
    height: 100,
    justifyContent: 'flex-end',
  },
  chartBar: {
    width: 24,
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    minHeight: 3,
  },
  chartBarDim: {
    opacity: 0.28,
  },
  chartPeakValue: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  chartBaseline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: 8,
  },
  chartEmpty: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 32,
  },
  chartLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 8,
  },
  sectionCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 12,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    // Bleeds to the card edge so the pressed fill spans the row.
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  eventRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  eventRank: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  eventRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  eventInfo: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  eventStats: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
