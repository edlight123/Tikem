import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Receipt } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { colors as T, font, radius, spacing } from '../../theme/tokens';
import { useAppAlert } from '../../components/AppAlert';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import StatTriplet from '../../components/StatTriplet';
import StatusChip from '../../components/StatusChip';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import RefundConfirmSheet from '../../components/organizer/RefundConfirmSheet';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import {
  fetchEventOrders,
  getCachedEventOrders,
  refundTickets,
  resendTickets,
  type EventOrder,
} from '../../lib/api/eventOrders';
import { formatMoneyLines, isLiveTicket, methodKey, orderTone } from '../../lib/orderDisplay';

type RouteParams = { EventOrderDetail: { eventId: string; orderId: string } };

const findOrder = (eventId: string, orderId: string) =>
  getCachedEventOrders(eventId)?.orders.find((o) => o.id === orderId) ?? null;

/**
 * One order: who bought, what, how they paid — and the two organizer actions
 * the web attendee drawer offers, against the same routes:
 *   - Resend tickets  → POST /api/resend-ticket   (the screen's one white pill)
 *   - Refund          → POST /api/refund-ticket   (behind a confirmation sheet
 *                       that states the amount and currency)
 */
export default function EventOrderDetailScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'EventOrderDetail'>>();
  const navigation = useNavigation<any>();
  const { eventId, orderId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const { t } = useI18n();
  const { formatDate } = useLocaleFormat();
  const showAlert = useAppAlert();

  const [order, setOrder] = useState<EventOrder | null>(() => findOrder(eventId, orderId));
  const [eventCancelled, setEventCancelled] = useState(
    () => getCachedEventOrders(eventId)?.event.status === 'cancelled'
  );
  const [loading, setLoading] = useState(!order);
  const [refreshing, setRefreshing] = useState(false);
  const [resending, setResending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchEventOrders(eventId);
      setOrder(res.orders.find((o) => o.id === orderId) ?? null);
      setEventCancelled(res.event.status === 'cancelled');
    } catch (e) {
      console.warn('[EventOrderDetail] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [eventId, orderId]);

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

  const liveTicketIds = useMemo(
    () => (order ? order.tickets.filter((tk) => isLiveTicket(tk.status)).map((tk) => tk.id) : []),
    [order]
  );

  const handleResend = async () => {
    if (!order || resending || liveTicketIds.length === 0) return;
    setResending(true);
    try {
      await resendTickets(liveTicketIds);
      showAlert(
        t('organizerOrders.detail.resendSuccessTitle'),
        t('organizerOrders.detail.resendSuccessBody', { email: order.buyer.email })
      );
    } catch (e: any) {
      const code = e?.code;
      showAlert(
        t('common.error'),
        code === 'too_soon'
          ? t('organizerOrders.detail.resendTooSoon')
          : code === 'no_email'
            ? t('organizerOrders.detail.resendNoEmail')
            : t('organizerOrders.detail.resendFailed')
      );
    } finally {
      setResending(false);
    }
  };

  const handleRefund = async () => {
    if (!order || refunding) return;
    setRefunding(true);
    try {
      const result = await refundTickets(order.refund.eligibleTicketIds);
      setSheetOpen(false);
      const card = result.refunded ?? [];
      const queued = result.queued ?? [];
      const sum = (rows: { amount: number; currency: string }[]) => {
        const m = new Map<string, number>();
        rows.forEach((r) => m.set(r.currency, (m.get(r.currency) || 0) + r.amount));
        return formatMoneyLines(Array.from(m.entries()).map(([currency, amount]) => ({ currency, amount })));
      };
      const lines = [
        card.length ? t('organizerOrders.refundSheet.successCard', { amount: sum(card) }) : '',
        queued.length ? t('organizerOrders.refundSheet.successManual', { amount: sum(queued) }) : '',
        result.review?.length
          ? t(
              result.reviewReason === 'haiti_manual_approval'
                ? 'organizerOrders.refundSheet.successReviewHaiti'
                : 'organizerOrders.refundSheet.successReview',
              { n: result.review.length }
            )
          : '',
        result.failed?.length ? t('organizerOrders.refundSheet.partialFailed', { n: result.failed.length }) : '',
      ].filter(Boolean);
      const onlyReview = card.length + queued.length === 0 && (result.review?.length ?? 0) > 0;
      showAlert(
        onlyReview ? t('organizerOrders.refundSheet.reviewTitle') : t('organizerOrders.refundSheet.successTitle'),
        lines.join('\n\n')
      );
      await load();
    } catch (e: any) {
      setSheetOpen(false);
      showAlert(
        t('common.error'),
        e?.code === 'event_cancelled'
          ? t('organizerOrders.detail.refundNotPossible.event_cancelled')
          : t('organizerOrders.refundSheet.failed')
      );
      await load();
    } finally {
      setRefunding(false);
    }
  };

  const header = (
    <OrganizerScreenHeader
      title={order?.buyer.name || t('organizerOrders.unknownBuyer')}
      subtitle={order?.purchasedAt ? formatDate(order.purchasedAt, 'MMM d, yyyy • h:mm a') : undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <OrganizerScreenHeader title=" " onBack={() => navigation.goBack()} overlay onHeight={onHeight} />
        <View style={{ paddingTop: headerH, paddingHorizontal: spacing.lg }}>
          <StatTriplet
            items={[
              { label: t('organizerOrders.detail.stats.amount'), value: null },
              { label: t('organizerOrders.detail.stats.tickets'), value: null },
              { label: t('organizerOrders.detail.stats.checkedIn'), value: null },
            ]}
          />
          {[96, 140, 120].map((h, i) => (
            <View key={i} style={{ marginTop: 28 }}>
              <Skeleton width={110} height={18} radius={6} style={{ marginBottom: 14 }} />
              <Skeleton width="100%" height={h} radius={radius.lg} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH, flex: 1, justifyContent: 'center' }}>
          <EmptyState icon={Receipt} title={t('organizerOrders.detail.notFound')} />
        </View>
      </View>
    );
  }

  const paidTickets = order.tickets.filter((tk) => tk.pricePaid > 0);
  const firstIneligible = order.tickets.find((tk) => isLiveTicket(tk.status) && !tk.refund.eligible)?.refund;
  const refundBlockReason: string | null = eventCancelled
    ? 'event_cancelled'
    : order.refund.eligibleTicketIds.length > 0
      ? null
      : paidTickets.length === 0
        ? 'free'
        : firstIneligible && !firstIneligible.eligible
          ? firstIneligible.reason
          : order.status === 'refund_pending'
            ? 'refund_in_progress'
            : order.status === 'refunded'
              ? 'already_refunded'
              : 'not_live';
  const canRefund = !refundBlockReason;
  const amountValue = order.amounts.length ? formatMoneyLines(order.amounts) : t('organizerOrders.free');

  return (
    <View style={styles.container}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.gutter}>
          <StatTriplet
            items={[
              { label: t('organizerOrders.detail.stats.amount'), value: amountValue },
              { label: t('organizerOrders.detail.stats.tickets'), value: order.quantity },
              { label: t('organizerOrders.detail.stats.checkedIn'), value: `${order.checkedInCount}/${order.liveCount}` },
            ]}
          />
          <View style={styles.statusRow}>
            <StatusChip status={orderTone(order.status)} label={t(`organizerOrders.status.${order.status}`)} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('organizerOrders.detail.sections.buyer')} />
          <View style={styles.card}>
            <InfoRow styles={styles} label={t('organizerOrders.detail.email')} value={order.buyer.email || t('organizerOrders.detail.noEmail')} />
            <InfoRow styles={styles} label={t('organizerOrders.detail.city')} value={order.buyer.city || t('organizerOrders.detail.noCity')} />
            <InfoRow
              styles={styles}
              label={t('organizerOrders.detail.checkout')}
              value={order.isGuest ? t('organizerOrders.detail.guestCheckout') : t('organizerOrders.detail.accountCheckout')}
              last
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('organizerOrders.detail.sections.tickets')} />
          <View style={styles.card}>
            {order.tickets.map((tk, i) => {
              const live = isLiveTicket(tk.status);
              return (
                <View key={tk.id} style={[styles.ticketRow, i < order.tickets.length - 1 && styles.infoRowDivider]}>
                  <View style={styles.ticketMain}>
                    <Text style={[styles.ticketTier, !live && styles.ticketTierMuted]} numberOfLines={1}>
                      {tk.tierName || t('organizerOrders.generalAdmission')}
                    </Text>
                    <Text style={styles.ticketId} numberOfLines={1} selectable>
                      {tk.id}
                    </Text>
                  </View>
                  <View style={styles.ticketSide}>
                    <Text style={[styles.ticketPrice, !live && styles.ticketPriceMuted]}>
                      {tk.pricePaid > 0
                        ? formatMoneyLines([{ currency: tk.currency, amount: tk.pricePaid }])
                        : t('organizerOrders.free')}
                    </Text>
                    {live ? (
                      <StatusChip
                        status={tk.checkedInAt ? 'success' : 'neutral'}
                        label={
                          tk.checkedInAt
                            ? t('organizerOrders.detail.checkedInAt', { time: formatDate(tk.checkedInAt, 'MMM d, h:mm a') })
                            : t('organizerOrders.detail.notCheckedIn')
                        }
                      />
                    ) : (
                      <StatusChip
                        status={tk.status === 'refund_pending' ? 'pending' : 'neutral'}
                        label={t(
                          `organizerOrders.status.${tk.status === 'refund_pending' ? 'refund_pending' : tk.status === 'refunded' ? 'refunded' : 'cancelled'}`
                        )}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('organizerOrders.detail.sections.payment')} />
          <View style={styles.card}>
            <InfoRow styles={styles} label={t('organizerOrders.detail.method')} value={t(`organizerOrders.method.${methodKey(order.paymentMethod)}`)} />
            <InfoRow styles={styles} label={t('organizerOrders.detail.orderId')} value={order.id} mono />
            <InfoRow
              styles={styles}
              label={t('organizerOrders.detail.purchased')}
              value={order.purchasedAt ? formatDate(order.purchasedAt, 'MMM d, yyyy • h:mm a') : '—'}
              last
            />
          </View>
        </View>

        <View style={[styles.gutter, styles.actions]}>
          <WhitePillCTA
            label={liveTicketIds.length > 1 ? t('organizerOrders.detail.resend') : t('organizerOrders.detail.resendOne')}
            icon={<Ionicons name="paper-plane-outline" size={18} color={T.onWhite} />}
            onPress={handleResend}
            loading={resending}
            disabled={!order.canResend}
          />
          {!order.buyer.email ? (
            <Text style={styles.note}>{t('organizerOrders.detail.resendNoEmail')}</Text>
          ) : null}

          {canRefund ? (
            <TouchableOpacity
              style={styles.refundBtn}
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
              activeOpacity={0.75}
            >
              <Ionicons name="return-down-back-outline" size={18} color={T.red} />
              <Text style={styles.refundText} numberOfLines={1}>
                {t('organizerOrders.detail.refund')} · {formatMoneyLines(order.refund.totals)}
              </Text>
            </TouchableOpacity>
          ) : refundBlockReason && refundBlockReason !== 'free' ? (
            <Text style={styles.note}>{t(`organizerOrders.detail.refundNotPossible.${refundBlockReason}`)}</Text>
          ) : null}
        </View>
      </ScrollView>

      <RefundConfirmSheet
        visible={sheetOpen}
        totals={order.refund.totals}
        ticketCount={order.refund.eligibleTicketIds.length}
        totalTickets={order.quantity}
        rails={order.refund.rails}
        busy={refunding}
        onCancel={() => setSheetOpen(false)}
        onConfirm={handleRefund}
      />
    </View>
  );
}

function InfoRow({
  styles,
  label,
  value,
  mono,
  last,
}: {
  styles: ReturnType<typeof getStyles>;
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.mono]} numberOfLines={1} selectable={mono} ellipsizeMode="middle">
        {value}
      </Text>
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
    statusRow: {
      marginTop: spacing.md,
    },
    section: {
      paddingHorizontal: spacing.lg,
      paddingTop: 28,
    },
    // Surface fill, a brightness step above the canvas; hairlines only between
    // rows inside the card (a dense breakdown — the brief's one allowance).
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      paddingVertical: 14,
    },
    infoRowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    infoLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    infoValue: {
      flexShrink: 1,
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
      textAlign: 'right',
    },
    mono: {
      fontFamily: font.mono,
      fontSize: 12,
      fontWeight: '400',
    },
    ticketRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
    },
    ticketMain: {
      flex: 1,
    },
    ticketTier: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    ticketTierMuted: {
      color: colors.textTertiary,
    },
    ticketId: {
      marginTop: 4,
      fontFamily: font.monoRegular,
      fontSize: 11,
      color: colors.textTertiary,
    },
    ticketSide: {
      alignItems: 'flex-end',
      gap: 6,
    },
    ticketPrice: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    ticketPriceMuted: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
    actions: {
      paddingTop: 32,
      gap: 12,
    },
    // Destructive, but quiet: red label on a faint red wash, below the pill.
    refundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 52,
      borderRadius: radius.button,
      backgroundColor: T.redMuted,
      paddingHorizontal: spacing.lg,
    },
    refundText: {
      fontSize: 15,
      fontWeight: '700',
      color: T.red,
      fontVariant: ['tabular-nums'],
    },
    note: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
  });
