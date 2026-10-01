import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Wallet } from 'lucide-react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getOrganizerEvents, OrganizerEvent } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';
import { safeFormatForLanguage } from '../../lib/dates';
import { formatCurrency } from '../../lib/currency';
import {
  earningsCurrency,
  totalsByCurrency,
  withdrawableMinor,
  type EventEarningsRow,
} from '../../lib/eventEarnings';
import { font, radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import StatusChip from '../../components/StatusChip';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import FormSheet from '../../components/organizer/FormSheet';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';

type EventMoney = {
  /** Withdrawable now, minor units (the figure the per-event withdraw routes accept). */
  availableMinor: number;
  /** Net earned over the event's life, minor units. */
  netMinor: number | null;
  grossMinor: number;
  withdrawnMinor: number;
  currency: string;
};

type PayoutHistoryItem = {
  id: string;
  amount: number;
  status: string;
  method?: string;
  currency?: string;
  createdAt: string;
};

/** How many per-event earnings requests run at once. */
const FETCH_CONCURRENCY = 5;

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Org-level Earnings: leads with what the organizer can withdraw RIGHT NOW,
 * per currency (never summed across currencies), with one Withdraw action.
 *
 * Withdrawals on mobile are paid per event (withdraw-moncash / withdraw-bank
 * reserve and debit one event's earnings row), so the balance here is the sum
 * of each event's withdrawable figure, computed exactly as the per-event screen
 * and the withdraw routes compute it (lib/eventEarnings.ts). Withdraw takes the
 * organizer straight into that existing per-event withdrawal sheet: directly
 * when one event holds the balance, through a short "withdraw from" list when
 * several do. The by-event list below is an optional breakdown.
 */
export default function OrganizerEarningsHubScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [money, setMoney] = useState<Record<string, EventMoney>>({});
  const [loaded, setLoaded] = useState(false);
  const [moneyLoaded, setMoneyLoaded] = useState(false);
  const [moneyFailed, setMoneyFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payouts, setPayouts] = useState<PayoutHistoryItem[] | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!userProfile?.id || inFlight.current) return;
    inFlight.current = true;
    try {
      // Recent payouts load alongside; a failure only hides that section.
      backendJson<{ payouts?: PayoutHistoryItem[] }>('/api/organizer/payout-history')
        .then((d) =>
          setPayouts(
            (d?.payouts || [])
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3)
          )
        )
        .catch(() => setPayouts(null));

      const rows = await getOrganizerEvents(userProfile.id, 100);
      // Most recent first: the event you're settling is almost always the latest.
      rows.sort((a, b) => new Date(b.start_datetime).getTime() - new Date(a.start_datetime).getTime());
      setEvents(rows);
      setLoaded(true);

      // A draft has never sold anything, so it has nothing to withdraw.
      const priced = rows.filter((e) => e.status !== 'draft' || (e.tickets_sold || 0) > 0);
      let failures = 0;
      const results = await mapLimited(priced, FETCH_CONCURRENCY, async (e) => {
        try {
          const res = await backendJson<{ earnings: EventEarningsRow | null }>(
            `/api/organizer/events/${e.id}/earnings`
          );
          const row = res?.earnings || null;
          if (!row) return [e.id, null] as const;
          const net = typeof row.netAmount === 'number' && Number.isFinite(row.netAmount) ? row.netAmount : null;
          return [
            e.id,
            {
              availableMinor: withdrawableMinor(row),
              netMinor: net,
              grossMinor: Math.max(0, Number(row.grossSales || 0)),
              withdrawnMinor: Math.max(0, Number(row.withdrawnAmount || 0)),
              currency: earningsCurrency(row),
            },
          ] as const;
        } catch {
          failures += 1;
          return [e.id, null] as const;
        }
      });
      const next: Record<string, EventMoney> = {};
      for (const [id, m] of results) if (m) next[id] = m;
      setMoney(next);
      setMoneyFailed(priced.length > 0 && failures === priced.length);
    } catch (e) {
      console.error('Failed to load earnings hub', e);
    } finally {
      setLoaded(true);
      setMoneyLoaded(true);
      inFlight.current = false;
    }
  }, [userProfile?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const withBalance = useMemo(
    () =>
      events
        .filter((e) => (money[e.id]?.availableMinor || 0) > 0)
        .sort((a, b) => (money[b.id]?.availableMinor || 0) - (money[a.id]?.availableMinor || 0)),
    [events, money]
  );

  const totals = useMemo(
    () =>
      totalsByCurrency(
        withBalance.map((e) => ({ currency: money[e.id].currency, amountMinor: money[e.id].availableMinor }))
      ),
    [withBalance, money]
  );

  // A confident zero in the organizer's usual currency (POSH §2.3).
  const zeroCurrency = useMemo(() => {
    const first = Object.values(money)[0]?.currency;
    return first || 'HTG';
  }, [money]);

  // Lifetime figures in the lead currency: gross sales, net to you, already
  // withdrawn. Only rows in that currency are added, never a mix.
  const leadCurrency = totals[0]?.currency || zeroCurrency;
  const stats = useMemo(() => {
    let gross = 0;
    let net = 0;
    let withdrawn = 0;
    for (const m of Object.values(money)) {
      if (m.currency !== leadCurrency) continue;
      gross += m.grossMinor;
      net += m.netMinor || 0;
      withdrawn += m.withdrawnMinor;
    }
    return { gross, net, withdrawn };
  }, [money, leadCurrency]);

  const payoutTone = (status: string) => {
    const k = String(status).toLowerCase();
    if (k === 'completed') return { tone: 'success', key: 'completed' };
    if (k === 'processing' || k === 'pending') return { tone: 'pending', key: k };
    if (k === 'failed') return { tone: 'error', key: 'failed' };
    if (k === 'cancelled') return { tone: 'neutral', key: 'cancelled' };
    return { tone: 'neutral', key: null as string | null };
  };
  const payoutMethodLabel = (method?: string) => {
    const k = String(method || '').toLowerCase();
    if (k.includes('mobile') || k.includes('moncash')) return 'MonCash';
    if (k.includes('bank')) return t('organizerPayoutSettings.payoutHistory.method.bank');
    if (k.includes('stripe')) return 'Stripe';
    return method || '';
  };

  const startWithdraw = (eventId: string) => {
    setPickerOpen(false);
    navigation.navigate('OrganizerEventEarnings', { eventId, autoWithdraw: true });
  };

  const onWithdraw = () => {
    if (withBalance.length === 1) startWithdraw(withBalance[0].id);
    else if (withBalance.length > 1) setPickerOpen(true);
  };

  const readyLine =
    withBalance.length === 0
      ? t('organizerEarningsHub.nothingReady')
      : withBalance.length === 1
        ? t('organizerEarningsHub.readyFromOne')
        : t('organizerEarningsHub.readyFrom').replace('{n}', String(withBalance.length));

  const splitAmount = (minor: number, currency: string) => {
    // "210,000.00 HTG" -> big number + small code; "$1,240.00" stays whole.
    const text = formatCurrency(minor, currency, { fromCents: true, decimals: currency === 'HTG' ? 0 : 2 });
    const m = /^(.*) ([A-Z]{3})$/.exec(text);
    return m ? { big: m[1], code: m[2] } : { big: text, code: '' };
  };

  const renderBalance = () => {
    if (!moneyLoaded) {
      return (
        <View style={styles.balanceBlock}>
          <Skeleton width="62%" height={48} radius={8} />
          <Skeleton width="44%" height={12} radius={5} style={{ marginTop: 12 }} />
        </View>
      );
    }
    const rows = totals.length ? totals : [{ currency: zeroCurrency, amountMinor: 0 }];
    const lead = splitAmount(rows[0].amountMinor, rows[0].currency);
    return (
      <View style={styles.balanceBlock}>
        <View style={styles.balanceRow}>
          <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit>
            {lead.big}
          </Text>
          {lead.code ? <Text style={styles.balanceCode}>{lead.code}</Text> : null}
        </View>
        {/* Other currencies stay separate lines, never added to the first. */}
        {rows.slice(1).map((row) => (
          <Text key={row.currency} style={styles.balanceSecondary}>
            {t('organizerEarningsHub.availableIn')
              .replace('{amount}', formatCurrency(row.amountMinor, row.currency, { fromCents: true }))
              .replace('{currency}', row.currency)}
          </Text>
        ))}
        <Text style={styles.balanceMeta}>
          {moneyFailed ? t('organizerEarningsHub.balanceUnavailable') : readyLine}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('organizerEarningsHub.title').toLowerCase()}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH + 8 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {!loaded ? (
          [0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={85} radius={10} style={{ marginBottom: 18 }} />
          ))
        ) : events.length === 0 ? (
          <EmptyState icon={Wallet} title={t('organizerEarningsHub.empty')} compact />
        ) : (
          <>
            <Text style={styles.monoLabel}>{t('organizerEarningsHub.availableTitle')}</Text>
            {renderBalance()}

            {/* The one white pill on this screen (POSH §2.2). */}
            <WhitePillCTA
              label={t('organizerEarningsHub.withdraw')}
              onPress={onWithdraw}
              disabled={!moneyLoaded || withBalance.length === 0}
            />

            <TouchableOpacity
              style={styles.settingsLink}
              onPress={() => navigation.navigate('OrganizerPayoutSettings')}
              accessibilityRole="button"
            >
              <Text style={styles.settingsLinkText}>{t('organizerEarningsHub.payoutSettings')}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </TouchableOpacity>

            {moneyLoaded && !moneyFailed ? (
              <View style={styles.statsRow}>
                {[
                  { label: t('organizerEarningsHub.statGross'), value: stats.gross },
                  { label: t('organizerEarningsHub.statNet'), value: stats.net },
                  { label: t('organizerEarningsHub.statWithdrawn'), value: stats.withdrawn },
                ].map((st) => (
                  <View key={st.label} style={styles.stat}>
                    <Text style={styles.statLabel}>{st.label}</Text>
                    <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatCurrency(st.value, leadCurrency, { fromCents: true, decimals: leadCurrency === 'HTG' ? 0 : 2 })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.byEventHeader}>
              <SectionHeader title={t('organizerEarningsHub.byEventTitle')} />
            </View>

            {events.map((event) => {
              const posterUri = event.banner_image_url || event.cover_image_url;
              const when = event.start_datetime
                ? safeFormatForLanguage(event.start_datetime, 'MMM d', language)
                : '';
              const m = money[event.id];
              const net =
                m && m.netMinor != null ? formatCurrency(m.netMinor, m.currency, { fromCents: true }) : null;

              return (
                <TouchableOpacity
                  key={event.id}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('OrganizerEventEarnings', { eventId: event.id })}
                >
                  {posterUri ? (
                    <Image
                      source={{ uri: posterUri }}
                      style={styles.poster}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={150}
                      recyclingKey={event.id}
                    />
                  ) : (
                    <View style={[styles.poster, styles.posterFallback]}>
                      <Ionicons name="image-outline" size={16} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {event.title}
                    </Text>
                    {!!when && (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {when}
                      </Text>
                    )}
                  </View>
                  {net ? (
                    <View style={styles.rowRight}>
                      <Text style={styles.rowNet} numberOfLines={1}>
                        {net}
                      </Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}

            {payouts && payouts.length > 0 ? (
              <>
                <View style={styles.byEventHeader}>
                  <SectionHeader title={t('organizerEarningsHub.recentPayouts')} />
                </View>
                {payouts.map((p) => {
                  const tone = payoutTone(p.status);
                  return (
                    <View key={p.id} style={styles.payoutRow}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={styles.payoutAmount}>
                          {formatCurrency(p.amount, p.currency || 'HTG', { fromCents: true })}
                        </Text>
                        <Text style={styles.payoutMeta} numberOfLines={1}>
                          {[payoutMethodLabel(p.method), safeFormatForLanguage(p.createdAt, 'MMM d', language)]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <StatusChip
                        status={tone.tone}
                        label={tone.key ? t(`organizerPayoutSettings.payoutHistory.status.${tone.key}`) : p.status}
                      />
                    </View>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Several events hold money: pick which balance to send. Only events with
          something to withdraw are listed, largest first. */}
      <FormSheet
        visible={pickerOpen}
        title={t('organizerEarningsHub.pickTitle')}
        onClose={() => setPickerOpen(false)}
        closeLabel={t('common.close')}
      >
        <Text style={styles.sheetBody}>{t('organizerEarningsHub.pickBody')}</Text>
        {withBalance.map((event) => {
          const m = money[event.id];
          return (
            <TouchableOpacity
              key={event.id}
              style={styles.pickRow}
              activeOpacity={0.75}
              onPress={() => startWithdraw(event.id)}
              accessibilityRole="button"
            >
              <Text style={styles.pickTitle} numberOfLines={1}>
                {event.title}
              </Text>
              <Text style={styles.pickAmount} numberOfLines={1}>
                {formatCurrency(m.availableMinor, m.currency, { fromCents: true })}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        })}
      </FormSheet>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    monoLabel: {
      fontFamily: font.mono,
      fontSize: 11,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    balanceBlock: {
      marginBottom: 22,
    },
    balanceRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 10,
    },
    balance: {
      flexShrink: 1,
      fontSize: 52,
      lineHeight: 60,
      fontWeight: '800',
      letterSpacing: -1,
      color: colors.text,
    },
    balanceCode: {
      fontSize: 22,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    balanceSecondary: {
      marginTop: 4,
      fontSize: 16,
      color: colors.textSecondary,
    },
    settingsLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 16,
    },
    settingsLinkText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    statsRow: {
      flexDirection: 'row',
      paddingVertical: 16,
      paddingHorizontal: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      marginTop: 4,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    statLabel: {
      fontFamily: font.mono,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    statValue: {
      marginTop: 6,
      fontFamily: font.mono,
      fontSize: 14,
      color: colors.text,
    },
    payoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      marginBottom: 10,
    },
    payoutAmount: {
      fontFamily: font.mono,
      fontSize: 16,
      color: colors.text,
    },
    payoutMeta: {
      marginTop: 4,
      fontFamily: font.mono,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    balanceMeta: {
      marginTop: 6,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    byEventHeader: {
      marginTop: 32,
    },
    // Filled rows: poster, name, date, net, chevron.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      marginBottom: 10,
    },
    poster: {
      width: 48,
      height: 60,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    posterFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    rowMeta: {
      marginTop: 4,
      fontFamily: font.mono,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    rowRight: {
      alignItems: 'flex-end',
      maxWidth: 130,
    },
    rowNet: {
      fontFamily: font.mono,
      fontSize: 14,
      color: colors.text,
    },
    rowNetLabel: {
      marginTop: 2,
      fontSize: 11,
      color: colors.textTertiary,
    },
    sheetBody: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginBottom: 14,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      marginBottom: 8,
    },
    pickTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    pickAmount: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
  });
