import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
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
import { formatMoneyLines, isLiveTicket, liveRevenue, methodKey, orderTone } from '../../lib/orderDisplay';

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
            <Skeleton width="100%" height={48} radius={radius.md} style={{ marginBottom: spacing.md }} />
          </View>
          <View style={styles.tabsSkeleton}>
            {[64, 72, 92].map((w, i) => (
              <Skeleton key={i} width={w} height={35} radius={radius.button} />
            ))}
          </View>
          <View style={styles.gutter}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={92} radius={radius.lg} style={{ marginBottom: 10 }} />
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

  const renderOrder = ({ item }: { item: EventOrder }) => {
    const tierLabel = item.tiers
      .map((tier) => `${tier.name || t('organizerOrders.generalAdmission')}${tier.count > 1 ? ` ×${tier.count}` : ''}`)
      .join(', ');
    const meta = [
      tierLabel,
      t(`organizerOrders.method.${methodKey(item.paymentMethod)}`),
      item.purchasedAt ? formatDate(item.purchasedAt, 'MMM d') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    // Struck through only when none of the money is still live.
    const muted = item.status === 'refunded' || item.status === 'refund_pending' || item.status === 'cancelled';

    return (
      <Pressable
        onPress={() => navigation.navigate('EventOrderDetail', { eventId, orderId: item.id })}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${item.buyer.name || t('organizerOrders.unknownBuyer')}, ${formatMoneyLines(item.amounts) || t('organizerOrders.free')}`}
      >
        <View style={styles.rowTop}>
          <Text style={styles.buyerName} numberOfLines={1}>
            {item.buyer.name || t('organizerOrders.unknownBuyer')}
          </Text>
          <Text style={[styles.amount, muted && styles.amountMuted]} numberOfLines={1}>
            {item.amounts.length ? formatMoneyLines(item.amounts) : t('organizerOrders.free')}
          </Text>
        </View>
        <View style={styles.rowMiddle}>
          <Text style={styles.email} numberOfLines={1}>
            {item.buyer.email || ' '}
          </Text>
          <StatusChip status={orderTone(item.status)} label={t(`organizerOrders.status.${item.status}`)} />
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.qty}>
            {item.quantity === 1
              ? t('organizerOrders.ticketsOne')
              : t('organizerOrders.ticketsMany', { n: item.quantity })}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {header}
      <FlatList
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
                  { label: t('organizerOrders.stats.revenue'), value: stats.revenue, caption: stats.revenueCaption },
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
            <EmptyState
              icon={ShoppingBag}
              title={t('organizerOrders.empty.title')}
              subtitle={t('organizerOrders.empty.body')}
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              compact
              title={t('organizerOrders.empty.filteredTitle')}
              subtitle={t('organizerOrders.empty.filteredBody')}
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
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    tabs: {
      marginBottom: 12,
    },
    // Cards are a brightness step above the canvas — never a border.
    row: {
      marginHorizontal: spacing.lg,
      marginBottom: 10,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    rowPressed: {
      backgroundColor: colors.surfaceRaised,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12,
    },
    buyerName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    amount: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.2,
    },
    amountMuted: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
    rowMiddle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 4,
    },
    email: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
    },
    rowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
    },
    qty: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    meta: {
      flex: 1,
      fontSize: 12,
      color: colors.textTertiary,
    },
  });
