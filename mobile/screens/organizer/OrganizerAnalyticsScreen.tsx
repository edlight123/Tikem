import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
    RefreshControl,
} from 'react-native';
import { radius } from '../../theme/tokens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { backendFetch } from '../../lib/api/backend';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { format, subDays, startOfDay } from 'date-fns';
import { safeFormatForLanguage } from '../../lib/dates';
import { normalizeCurrency } from '../../lib/currency';
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

export default function OrganizerAnalyticsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const { formatMoney: fmtMoney } = useLocaleFormat();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalEvents: 0,
    publishedEvents: 0,
    totalTicketsSold: 0,
    totalRevenue: 0,
    currency: normalizeCurrency(null),
  });
  // Revenue per currency, largest first. Never summed across currencies.
  const [revenueByCurrency, setRevenueByCurrency] = useState<CurrencyAmount[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [topEvents, setTopEvents] = useState<EventStats[]>([]);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');

  useEffect(() => {
    loadData();
  }, [userProfile?.id, timeRange]);

  const loadData = async () => {
    if (!userProfile?.id) return;

    try {
      // Fetch analytics from the web API (same endpoint the web uses)
      const response = await backendFetch(`/api/organizer/analytics?range=${timeRange}`);
      
      if (response.ok) {
        const data = await response.json();
        setStats({
          totalEvents: data.totalEvents || 0,
          publishedEvents: data.publishedEvents || 0,
          totalTicketsSold: data.totalTicketsSold || 0,
          totalRevenue: data.totalRevenue || 0,
          currency: normalizeCurrency(data.currency),
        });
        // Major units, keyed by every currency that sold (not just USD/HTG).
        setRevenueByCurrency(revenueListFromApi(data.revenueByCurrency));
        setChartData(data.chartData || []);
        setTopEvents(data.topEvents || []);
      } else {
        // Fallback: Load from Firebase directly
        await loadFromFirebase();
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
      await loadFromFirebase();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadFromFirebase = async () => {
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
        where('organizer_id', '==', userProfile?.id)
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

      for (const event of events) {
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
      }

      eventStats.sort((a, b) => b.ticketCount - a.ticketCount);

      // Per currency, largest first; the primary is the biggest, or the
      // organizer's usual event currency when nothing sold.
      const revenueRows = sumRevenueByCurrency(soldInRange, eventCurrencyById);
      const primaryCurrency = revenueRows[0]?.currency || dominantEventCurrency(events as any[]);

      setStats({
        totalEvents: events.length,
        publishedEvents: events.filter((e: any) => e.is_published).length,
        totalTicketsSold: totalTickets,
        totalRevenue: revenueRows[0]?.amount || 0,
        currency: primaryCurrency,
      });
      setRevenueByCurrency(revenueRows);
      setTopEvents(eventStats.slice(0, 5));

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
      setChartData(chart);
    } catch (error) {
      console.error('Error loading from Firebase:', error);
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
  const totalRevenueCell = () => {
    const [primary, ...rest] = revenueByCurrency;
    if (!primary) return { value: formatMoney(0, stats.currency) };
    return {
      value: formatMoney(primary.amount, primary.currency),
      caption: rest.length
        ? rest.map((r) => `+ ${formatMoney(r.amount, r.currency)}`).join('\n')
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
                <Skeleton key={i} width={82} height={35} radius={999} />
              ))}
            </View>
          </View>
          {/* Metric grid: the real 2-col StatTriplet with ••• placeholders. */}
          <View style={styles.statsWrap}>
            <StatTriplet
              columns={2}
              items={[
                { label: t('analytics.totalRevenue') || 'Total Revenue', value: null },
                { label: t('analytics.ticketsSold') || 'Tickets Sold', value: null },
                { label: t('analytics.totalEvents') || 'Total Events', value: null },
                { label: t('analytics.published') || 'Published', value: null },
              ]}
            />
          </View>
          {/* Sales chart card: title, 120-tall bar area, hairline baseline. */}
          <View style={styles.chartCard}>
            <Skeleton width={130} height={16} radius={6} style={{ marginBottom: 20 }} />
            <View style={styles.chartSkeletonRow}>
              {[46, 78, 60, 100, 34, 88, 52].map((h, i) => (
                <Skeleton key={i} width={24} height={h} radius={6} />
              ))}
            </View>
            <View style={styles.chartBaseline} />
          </View>
          {/* Top events card: title + rank-circle rows. */}
          <View style={styles.sectionCard}>
            <Skeleton width={170} height={16} radius={6} style={{ marginBottom: 16 }} />
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.eventRow}>
                <Skeleton width={32} height={32} radius={radius.lg} style={{ marginRight: 12 }} />
                <View style={styles.eventInfo}>
                  <Skeleton width="65%" height={15} radius={6} />
                  <Skeleton width="45%" height={13} radius={5} style={{ marginTop: 4 }} />
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
            onChange={(key) => setTimeRange(key as '7d' | '30d' | 'all')}
            tabs={[
              { key: '7d', label: t('analytics.7days') || '7 Days' },
              { key: '30d', label: t('analytics.30days') || '30 Days' },
              { key: 'all', label: t('analytics.allTime') || 'All Time' },
            ]}
          />
        </View>

        {/* Stats — the POSH metric grid (§2.3): neutral raised surface, teal only
            as the revenue numeral accent. */}
        <View style={styles.statsWrap}>
          <StatTriplet
            columns={2}
            items={[
              { label: t('analytics.totalRevenue') || 'Total Revenue', ...totalRevenueCell(), tone: 'brand' },
              { label: t('analytics.ticketsSold') || 'Tickets Sold', value: stats.totalTicketsSold },
              { label: t('analytics.totalEvents') || 'Total Events', value: stats.totalEvents },
              { label: t('analytics.published') || 'Published', value: stats.publishedEvents },
            ]}
          />
        </View>

        {/* Sales Chart */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>{t('analytics.salesOverTime') || 'Sales Over Time'}</Text>
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
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('analytics.topEvents') || 'Top Performing Events'}</Text>
          {topEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>{t('analytics.noData') || 'No ticket sales yet'}</Text>
            </View>
          ) : (
            topEvents.map((event, index) => (
              <TouchableOpacity
                key={event.id}
                style={styles.eventRow}
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
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
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
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.xl,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 20,
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
    backgroundColor: colors.primary,
    borderRadius: 6,
    minHeight: 3,
  },
  chartBarDim: {
    opacity: 0.35,
  },
  chartPeakValue: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
  },
  chartBaseline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: 8,
  },
  chartEmpty: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 32,
  },
  chartLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 8,
  },
  sectionCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 12,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventRank: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  eventRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
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
