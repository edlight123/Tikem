import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { BarChart2, WifiOff } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { radius, spacing } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import DailySalesChart from '../../components/organizer/DailySalesChart';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { fetchEventAnalytics, type EventAnalyticsResponse } from '../../lib/api/eventOrders';
import { formatMoneyLines } from '../../lib/orderDisplay';

type RouteParams = { EventAnalytics: { eventId: string; eventTitle?: string } };

/**
 * Per-event analytics — the mobile twin of the web's
 * organizer/events/[id]/analytics: the metric triplet, then sales over time,
 * sales by tier, buyers by city and the door's check-in rate.
 */
export default function EventAnalyticsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'EventAnalytics'>>();
  const navigation = useNavigation<any>();
  const { eventId, eventTitle } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const { t } = useI18n();
  const { formatDate } = useLocaleFormat();

  const [data, setData] = useState<EventAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchEventAnalytics(eventId));
      setFailed(false);
    } catch (e) {
      console.warn('[EventAnalytics] load failed', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const title = eventTitle || data?.event.title || '';
  const header = (
    <OrganizerScreenHeader
      title={t('organizerEventAnalytics.headerTitle')}
      subtitle={title || undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  const tripletLabels = {
    revenue: t('organizerEventAnalytics.stats.revenue'),
    sold: t('organizerEventAnalytics.stats.sold'),
    checkIn: t('organizerEventAnalytics.stats.checkIn'),
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH }}>
          <View style={styles.statsWrap}>
            <StatTriplet
              items={[
                { label: tripletLabels.revenue, value: null },
                { label: tripletLabels.sold, value: null },
                { label: tripletLabels.checkIn, value: null },
              ]}
            />
          </View>
          <View style={styles.section}>
            <Skeleton width={150} height={20} radius={6} style={{ marginBottom: 14 }} />
            <View style={styles.card}>
              <View style={styles.chartSkeletonRow}>
                {[40, 64, 30, 88, 52, 110, 46, 72, 36, 58].map((h, i) => (
                  <Skeleton key={i} width={14} height={h} radius={4} />
                ))}
              </View>
            </View>
          </View>
          {[0, 1].map((i) => (
            <View key={i} style={styles.section}>
              <Skeleton width={130} height={20} radius={6} style={{ marginBottom: 14 }} />
              <Skeleton width="100%" height={120} radius={radius.lg} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (failed && !data) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH, flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon={WifiOff}
            title={t('organizerEventAnalytics.loadFailedTitle')}
            subtitle={t('organizerEventAnalytics.loadFailedBody')}
            actionLabel={t('organizerEventAnalytics.retry')}
            onAction={() => {
              setLoading(true);
              load();
            }}
          />
        </View>
      </View>
    );
  }

  const a = data!.analytics;
  const currency = data!.event.currency || 'HTG';
  const [primaryRevenue, ...otherRevenue] = a.revenue;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const capacityPct = a.capacity > 0 ? Math.round((a.ticketsSold / a.capacity) * 100) : null;
  const bestDay = a.salesByDay.reduce<{ date: string; count: number } | null>(
    (best, d) => (!best || d.count > best.count ? d : best),
    null
  );
  const maxCity = Math.max(1, ...a.cities.map((c) => c.buyers));

  return (
    <View style={styles.container}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Metric triplet (§2.3). Confident zeros; extra currencies are a
            caption under the figure, never added into it. */}
        <View style={styles.statsWrap}>
          <StatTriplet
            items={[
              {
                label: tripletLabels.revenue,
                value: formatMoneyLines([primaryRevenue ?? { currency, amount: 0 }]),
                caption: otherRevenue.length ? otherRevenue.map((r) => `+ ${formatMoneyLines([r])}`).join('\n') : undefined,
                tone: 'brand',
              },
              {
                label: tripletLabels.sold,
                value: a.ticketsSold,
                caption:
                  capacityPct !== null
                    ? t('organizerEventAnalytics.ofCapacity', { pct: capacityPct, cap: a.capacity })
                    : undefined,
              },
              {
                label: tripletLabels.checkIn,
                value: a.ticketsSold > 0 ? pct(a.checkInRate) : '0%',
                caption: t('organizerEventAnalytics.checkedInCaption', { n: a.checkedIn }),
              },
            ]}
          />
        </View>

        {a.ticketsSold === 0 ? (
          <EmptyState
            icon={BarChart2}
            title={t('organizerEventAnalytics.empty.title')}
            subtitle={t('organizerEventAnalytics.empty.body')}
          />
        ) : (
          <>
            {/* Sales over time */}
            <View style={styles.section}>
              <SectionHeader
                title={t('organizerEventAnalytics.sections.salesOverTime')}
                subtitle={
                  a.salesByDay.length === 1
                    ? t('organizerEventAnalytics.daysWithSalesOne')
                    : t('organizerEventAnalytics.daysWithSales', { n: a.salesByDay.length })
                }
              />
              <View style={styles.card}>
                {bestDay ? (
                  <Text style={styles.cardEyebrow}>
                    {t('organizerEventAnalytics.bestDay', { n: bestDay.count })} · {formatDate(`${bestDay.date}T12:00:00`, 'MMM d')}
                  </Text>
                ) : null}
                <DailySalesChart
                  points={a.salesByDay}
                  formatDay={(d) => formatDate(`${d}T12:00:00`, 'MMM d')}
                />
              </View>
            </View>

            {/* Sales by tier */}
            {a.tiers.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t('organizerEventAnalytics.sections.byTier')} />
                <View style={styles.card}>
                  {a.tiers.map((tier, i) => {
                    const share = a.ticketsSold > 0 ? tier.sold / a.ticketsSold : 0;
                    return (
                      <View key={`${tier.name}-${i}`} style={[styles.barRow, i === a.tiers.length - 1 && styles.barRowLast]}>
                        <View style={styles.barHead}>
                          <Text style={styles.barName} numberOfLines={1}>
                            {tier.name || t('organizerOrders.generalAdmission')}
                          </Text>
                          <Text style={styles.barValue}>
                            {tier.sold} <Text style={styles.barPct}>{pct(share)}</Text>
                          </Text>
                        </View>
                        <View style={styles.track}>
                          <View style={[styles.fill, { width: `${Math.max(share * 100, 2)}%` }]} />
                        </View>
                        {tier.revenue.length > 0 ? (
                          <Text style={styles.barCaption}>{formatMoneyLines(tier.revenue)}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Buyers by city */}
            <View style={styles.section}>
              <SectionHeader title={t('organizerEventAnalytics.sections.byCity')} />
              <View style={styles.card}>
                {a.cities.length === 0 ? (
                  <Text style={styles.cardNote}>{t('organizerEventAnalytics.citiesEmpty')}</Text>
                ) : (
                  a.cities.slice(0, 8).map((c, i, list) => (
                    <View key={c.city} style={[styles.barRow, i === list.length - 1 && styles.barRowLast]}>
                      <View style={styles.barHead}>
                        <Text style={styles.barName} numberOfLines={1}>
                          {c.city}
                        </Text>
                        <Text style={styles.barValue}>
                          {c.buyers === 1
                            ? t('organizerEventAnalytics.buyersCountOne')
                            : t('organizerEventAnalytics.buyersCount', { n: c.buyers })}
                        </Text>
                      </View>
                      <View style={styles.track}>
                        <View style={[styles.fill, styles.fillNeutral, { width: `${Math.max((c.buyers / maxCity) * 100, 2)}%` }]} />
                      </View>
                    </View>
                  ))
                )}
              </View>
              {a.cities.length > 0 && a.buyersWithoutCity > 0 ? (
                <Text style={styles.footnote}>
                  {a.buyersWithoutCity === 1
                    ? t('organizerEventAnalytics.noCityNoteOne')
                    : t('organizerEventAnalytics.noCityNote', { n: a.buyersWithoutCity })}
                </Text>
              ) : null}
            </View>

            {/* Check-in */}
            <View style={styles.section}>
              <SectionHeader title={t('organizerEventAnalytics.sections.checkIn')} />
              <View style={styles.card}>
                <View style={styles.checkInHead}>
                  <Text style={styles.checkInPct}>{pct(a.checkInRate)}</Text>
                  <Text style={styles.checkInBody}>
                    {t('organizerEventAnalytics.checkInBody', { n: a.checkedIn, total: a.ticketsSold })}
                  </Text>
                </View>
                <View style={[styles.track, styles.trackTall]}>
                  <View style={[styles.fill, { width: `${Math.max(a.checkInRate * 100, a.checkedIn > 0 ? 2 : 0)}%` }]} />
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    statsWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    section: {
      paddingHorizontal: spacing.lg,
      paddingTop: 28,
    },
    // A fill a brightness step above the canvas — no hairline box.
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    cardEyebrow: {
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 14,
    },
    cardNote: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    chartSkeletonRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      height: 132,
    },
    barRow: {
      marginBottom: 16,
    },
    barRowLast: {
      marginBottom: 0,
    },
    barHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 8,
    },
    barName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    barValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    barPct: {
      fontWeight: '400',
      color: colors.textTertiary,
    },
    barCaption: {
      marginTop: 6,
      fontSize: 12,
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceRaised,
      overflow: 'hidden',
    },
    trackTall: {
      height: 8,
      borderRadius: 4,
    },
    fill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    // Cities are a ranking, not a status — kept neutral so teal stays scarce.
    fillNeutral: {
      backgroundColor: colors.textSecondary,
    },
    footnote: {
      marginTop: 10,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textTertiary,
    },
    checkInHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 12,
      marginBottom: 14,
    },
    checkInPct: {
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    checkInBody: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
