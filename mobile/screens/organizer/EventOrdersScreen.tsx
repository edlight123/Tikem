import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ShoppingBag, WifiOff } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { radius, spacing } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import EmptyState from '../../components/EmptyState';
import StatusChip from '../../components/StatusChip';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import {
  fetchEventOrders,
  getCachedEventOrders,
  orderSearchText,
  type EventOrder,
  type EventOrdersResponse,
} from '../../lib/api/eventOrders';
import { formatMoneyLines, isLiveTicket, liveRevenue, orderTone } from '../../lib/orderDisplay';

type RouteParams = { EventOrders: { eventId: string; eventTitle?: string } };
type Filter = 'all' | 'paid' | 'refunded';

const isRefundedOrder = (o: EventOrder) => o.status !== 'paid' && o.status !== 'free';

/**
 * Orders for one event — the mobile twin of the web's
 * organizer/events/[id]/orders. One row per purchase (tickets bought together
 * are one order), searchable by buyer name, email, order id or ticket id.
 */
export default function EventOrdersScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'EventOrders'>>();
  const navigation = useNavigation<any>();
  const { eventId, eventTitle } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const { t } = useI18n();
  const { formatDate } = useLocaleFormat();

  const cached = getCachedEventOrders(eventId);
  const [data, setData] = useState<EventOrdersResponse | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const res = await fetchEventOrders(eventId);
      setData(res);
      setFailed(false);
    } catch (e) {
      console.warn('[EventOrders] load failed', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Refetch on focus so a refund made on the detail screen shows on return.
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

  const orders = data?.orders ?? [];
  const title = eventTitle || data?.event.title || '';

  const counts = useMemo(
    () => ({
      all: orders.length,
      paid: orders.filter((o) => !isRefundedOrder(o)).length,
      refunded: orders.filter(isRefundedOrder).length,
    }),
    [orders]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === 'paid' && isRefundedOrder(o)) return false;
      if (filter === 'refunded' && !isRefundedOrder(o)) return false;
      return !q || orderSearchText(o).includes(q);
    });
  }, [orders, query, filter]);

  const stats = useMemo(() => {
    const revenue = liveRevenue(orders);
    const [primary, ...rest] = revenue;
    const liveTickets = orders.reduce((n, o) => n + o.tickets.filter((tk) => isLiveTicket(tk.status)).length, 0);
    return {
      // Every order free and no money taken: a free event, so no revenue cell.
      allFree: orders.length > 0 && revenue.length === 0 && orders.every((o) => !o.amounts.length),
      orders: orders.filter((o) => !isRefundedOrder(o)).length,
      tickets: liveTickets,
      revenue: primary ? formatMoneyLines([primary]) : formatMoneyLines([{ currency: data?.event.currency || 'HTG', amount: 0 }]),
      revenueCaption: rest.length ? rest.map((r) => `+ ${formatMoneyLines([r])}`).join('\n') : undefined,
    };
  }, [orders, data?.event.currency]);

  const header = (
    <OrganizerScreenHeader
      title={t('organizerOrders.headerTitle')}
      subtitle={title || undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH }}>
          <View style={styles.statsWrap}>
            <StatTriplet
              items={[
                { label: t('organizerOrders.stats.revenue'), value: null },
                { label: t('organizerOrders.stats.orders'), value: null },
                { label: t('organizerOrders.stats.tickets'), value: null },
              ]}
            />
          </View>
          <View style={styles.gutter}>
            <Skeleton width="100%" height={44} radius={radius.md} style={{ marginBottom: spacing.md }} />
          </View>
          <View style={styles.tabsSkeleton}>
            {[64, 72, 92].map((w, i) => (
              <Skeleton key={i} width={w} height={35} radius={radius.button} />
            ))}
          </View>
          <View style={styles.gutter}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={48} radius={radius.sm} style={{ marginBottom: 14 }} />
            ))}
          </View>
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
            title={t('organizerOrders.loadFailedTitle')}
            subtitle={t('organizerOrders.loadFailedBody')}
            actionLabel={t('organizerOrders.retry')}
            onAction={() => {
              setLoading(true);
              load();
            }}
          />
        </View>
      </View>
    );
  }

  // A plain list row (EventAttendeesScreen idiom): buyer, then a quiet
  // "1 ticket · tier · date" line; the amount (or "Free", said once) on the
  // right, with the order state under it only when it isn't a settled sale.
  const renderOrder = ({ item }: { item: EventOrder }) => {
    const tierLabel = item.tiers
      .map((tier) => `${tier.name || t('organizerOrders.generalAdmission')}${tier.count > 1 ? ` ×${tier.count}` : ''}`)
      .join(', ');
    const qty =
      item.quantity === 1 ? t('organizerOrders.ticketsOne') : t('organizerOrders.ticketsMany', { n: item.quantity });
    const meta = [qty, tierLabel, item.purchasedAt ? formatDate(item.purchasedAt, 'MMM d') : '']
      .filter(Boolean)
      .join(' · ');
    // Struck through only when none of the money is still live.
    const muted = item.status === 'refunded' || item.status === 'refund_pending' || item.status === 'cancelled';
    const settled = item.status === 'paid' || item.status === 'free';
    // Printed tickets are paid at a point of sale: never shown as revenue or "Free".
    const amount = item.amounts.length
      ? formatMoneyLines(item.amounts)
      : item.printed
        ? t('printedBundle.orderMarker')
        : t('organizerOrders.free');
    const buyer = item.buyer.name || item.buyer.email || t('organizerOrders.unknownBuyer');

    return (
      <Touchable
        scale={false}
        pressedColor={colors.surface}
        onPress={() => navigation.navigate('EventOrderDetail', { eventId, orderId: item.id })}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${buyer}, ${amount}`}
      >
        <View style={styles.rowMain}>
          <Text style={styles.buyerName} numberOfLines={1}>
            {buyer}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View style={styles.rowEnd}>
          {stats.allFree && settled ? (
            // Every order is free: "Free" on each of 74 rows is noise. A
            // quiet chevron says "tap for the order" instead.
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          ) : (
            <Text style={[styles.amount, muted && styles.amountMuted]} numberOfLines={1}>
              {amount}
            </Text>
          )}
          {!settled ? (
            <StatusChip status={orderTone(item.status)} label={t(`organizerOrders.status.${item.status}`)} />
          ) : null}
        </View>
      </Touchable>
    );
  };

  return (
    <View style={styles.container}>
      {header}
      <FlatList keyboardDismissMode="on-drag"
        data={visible}
        keyExtractor={(o) => o.id}
        renderItem={renderOrder}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View>
            <View style={styles.statsWrap}>
              <StatTriplet
                items={[
                  ...(stats.allFree
                    ? []
                    : [{ label: t('organizerOrders.stats.revenue'), value: stats.revenue, caption: stats.revenueCaption }]),
                  { label: t('organizerOrders.stats.orders'), value: stats.orders },
                  { label: t('organizerOrders.stats.tickets'), value: stats.tickets },
                ]}
              />
            </View>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('organizerOrders.searchPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.tabs}>
              <SegmentedTabs
                value={filter}
                onChange={(k) => setFilter(k as Filter)}
                tabs={[
                  { key: 'all', label: t('organizerOrders.filters.all'), count: counts.all },
                  { key: 'paid', label: t('organizerOrders.filters.paid'), count: counts.paid },
                  { key: 'refunded', label: t('organizerOrders.filters.refunded'), count: counts.refunded },
                ]}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          orders.length === 0 ? (
            <View style={styles.gutter}>
              <EmptyState
                variant="panel"
                icon={ShoppingBag}
                title={t('organizerOrders.empty.title')}
              />
            </View>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              compact
              title={t('organizerOrders.empty.filteredTitle')}
            />
          )
        }
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
    gutter: {
      paddingHorizontal: spacing.lg,
    },
    statsWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      marginBottom: 14,
    },
    tabsSkeleton: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: spacing.lg,
      paddingVertical: 4,
      marginBottom: 12,
    },
    // A filled field, no hairline (fill-not-hairline rule).
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      paddingHorizontal: 14,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      // 16 keeps iOS from zooming the field on focus.
      fontSize: 16,
      color: colors.text,
    },
    tabs: {
      marginBottom: 12,
    },
    // Plain list rows split by a hairline, no card fill (owner: lists are
    // rows, not stacks of cards). Same rhythm as EventAttendeesScreen.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 60,
      marginHorizontal: spacing.lg,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowMain: {
      flex: 1,
      minWidth: 0,
    },
    buyerName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowSub: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    rowEnd: {
      alignItems: 'flex-end',
      gap: 4,
      maxWidth: '45%',
    },
    amount: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.2,
    },
    amountMuted: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
  });
