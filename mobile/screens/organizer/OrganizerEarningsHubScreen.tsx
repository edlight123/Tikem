import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Wallet } from 'lucide-react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { safeFormatForLanguage } from '../../lib/dates';
import { formatCurrency } from '../../lib/currency';
import { totalsByCurrency } from '../../lib/eventEarnings';
import {
  getCachedEarningsHub,
  peekEarningsHub,
  refreshEarningsHub,
  type EarningsHubSnapshot,
  type EventMoney,
} from '../../lib/earningsHubCache';
import { radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import StatusChip from '../../components/StatusChip';
import WhitePillCTA from '../../components/WhitePillCTA';
import StatTriplet from '../../components/StatTriplet';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import FormSheet from '../../components/organizer/FormSheet';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';

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
 *
 * The data is computed off-screen (lib/earningsHubCache.ts): the hub opens on
 * the last snapshot, prefetched from the dashboard or persisted from a previous
 * session, and refreshes quietly in the background on every focus.
 */
export default function OrganizerEarningsHubScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const userId = userProfile?.id;

  const [snap, setSnap] = useState<EarningsHubSnapshot | null>(() =>
    userId ? peekEarningsHub(userId) : null
  );
  // True once a fetch has settled with no snapshot to show (so the empty/zero
  // states render instead of skeletons forever).
  const [settled, setSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate from memory or AsyncStorage as soon as the user is known.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getCachedEarningsHub(userId).then((cached) => {
      if (alive && cached) setSnap((cur) => (cur && cur.fetchedAt >= cached.fetchedAt ? cur : cached));
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const next = await refreshEarningsHub(userId);
      setSnap(next);
    } catch (e) {
      console.warn('Earnings hub refresh failed; showing cached data', e);
    } finally {
      setSettled(true);
    }
  }, [userId]);

  // Background refresh on every focus; the cached snapshot stays on screen meanwhile.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const events = snap?.events ?? [];
  const money: Record<string, EventMoney> = snap?.money ?? {};
  const payouts = snap?.payouts ?? null;
  const moneyFailed = snap?.moneyFailed ?? false;
  const loaded = !!snap || settled;
  const moneyLoaded = loaded;

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
  const payoutMethodIcon = (method?: string): keyof typeof Ionicons.glyphMap => {
    const k = String(method || '').toLowerCase();
    if (k.includes('mobile') || k.includes('moncash')) return 'phone-portrait-outline';
    if (k.includes('stripe')) return 'card-outline';
    return 'business-outline';
  };
  // Per-event status, only when the earnings row supports it: money ready now
  // (teal), or a balance still settling (amber). Fully paid-out events get none.
  const eventStatus = (m?: EventMoney) => {
    if (!m) return null;
    if (m.availableMinor > 0) {
      return { status: 'active', label: t('organizerEarnings.settlementLabels.ready') };
    }
    const remaining = (m.netMinor || 0) - m.withdrawnMinor;
    const s = String(m.settlementStatus || '').toLowerCase();
    if (remaining > 0 && (s === 'pending' || s === 'locked')) {
      return { status: 'pending', label: t(`organizerEarnings.settlementLabels.${s}`) };
    }
    return null;
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

  const fmtStat = (minor: number) =>
    formatCurrency(minor, leadCurrency, { fromCents: true, decimals: leadCurrency === 'HTG' ? 0 : 2 });

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
          <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
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
        title=""
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
        <Text style={styles.screenTitle} accessibilityRole="header">
          {t('organizerEarningsHub.title')}
        </Text>
        {!loaded ? (
          [0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={96} radius={radius.xl} style={{ marginBottom: 12 }} />
          ))
        ) : events.length === 0 ? (
          <EmptyState icon={Wallet} title={t('organizerEarningsHub.empty')} compact />
        ) : (
          <>
            <Text style={styles.eyebrow}>{t('organizerEarnings.availableToWithdraw')}</Text>
            {renderBalance()}

            {/* The one white primary action on this screen (POSH §2.2). */}
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
            </TouchableOpacity>

            {moneyLoaded && !moneyFailed ? (
              <View style={styles.statsWrap}>
                <StatTriplet
                  items={[
                    { label: t('organizerEarningsHub.statGross'), value: fmtStat(stats.gross) },
                    { label: t('organizerEarningsHub.statNet'), value: fmtStat(stats.net) },
                    { label: t('organizerEarningsHub.statWithdrawn'), value: fmtStat(stats.withdrawn) },
                  ]}
                />
              </View>
            ) : null}

            <View style={styles.byEventHeader}>
              <SectionHeader title={t('organizerEarningsHub.byEventTitle')} />
            </View>

            {events.map((event) => {
              const posterUri = event.banner_image_url || event.cover_image_url;
              const when = event.start_datetime
                ? safeFormatForLanguage(event.start_datetime, 'MMM d, yyyy', language)
                : '';
              const m = money[event.id];
              const net =
                m && m.netMinor != null ? formatCurrency(m.netMinor, m.currency, { fromCents: true }) : null;
              const chip = eventStatus(m);

              return (
                <TouchableOpacity
                  key={event.id}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('OrganizerEventEarnings', { eventId: event.id })}
                >
                  {/* Standalone 4:5 poster; the placeholder fill lives only inside its box. */}
                  <View style={styles.poster}>
                    {posterUri ? (
                      <Image
                        source={{ uri: posterUri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={150}
                        recyclingKey={event.id}
                      />
                    ) : (
                      <Ionicons name="image-outline" size={18} color={colors.textTertiary} />
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    {!!when && (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {when}
                      </Text>
                    )}
                  </View>
                  {net || chip ? (
                    <View style={styles.rowRight}>
                      {net ? (
                        <Text style={styles.rowNet} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          {net}
                        </Text>
                      ) : null}
                      {chip ? (
                        <View style={styles.rowChip}>
                          <StatusChip status={chip.status} label={chip.label} />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
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
                      <View style={styles.payoutIcon}>
                        <Ionicons name={payoutMethodIcon(p.method)} size={22} color={colors.text} />
                      </View>
                      <View style={styles.rowBody}>
                        {!!payoutMethodLabel(p.method) && (
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {payoutMethodLabel(p.method)}
                          </Text>
                        )}
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {safeFormatForLanguage(p.createdAt, 'MMM d, yyyy', language)}
                        </Text>
                      </View>
                      <View style={styles.rowRight}>
                        <Text style={styles.rowNet} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          {formatCurrency(p.amount, p.currency || 'HTG', { fromCents: true })}
                        </Text>
                        <View style={styles.rowChip}>
                          <StatusChip
                            status={tone.tone}
                            label={tone.key ? t(`organizerPayoutSettings.payoutHistory.status.${tone.key}`) : p.status}
                          />
                        </View>
                      </View>
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
      paddingBottom: 48,
    },
    screenTitle: {
      fontSize: 38,
      lineHeight: 44,
      fontWeight: '800',
      letterSpacing: -0.8,
      color: colors.text,
      marginBottom: 28,
    },
    eyebrow: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 8,
    },
    balanceBlock: {
      marginBottom: 28,
    },
    balanceRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 10,
    },
    balance: {
      flexShrink: 1,
      fontSize: 54,
      lineHeight: 62,
      fontWeight: '800',
      letterSpacing: -1.2,
      fontVariant: ['tabular-nums'],
      color: colors.text,
    },
    balanceCode: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    balanceSecondary: {
      marginTop: 4,
      fontSize: 16,
      fontVariant: ['tabular-nums'],
      color: colors.textSecondary,
    },
    balanceMeta: {
      marginTop: 8,
      fontSize: 15,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    settingsLink: {
      alignSelf: 'center',
      paddingVertical: 16,
      paddingHorizontal: 8,
    },
    settingsLinkText: {
      fontSize: 15,
      color: colors.textSecondary,
      textDecorationLine: 'underline',
    },
    statsWrap: {
      marginTop: 12,
    },
    byEventHeader: {
      marginTop: 36,
    },
    // By-event rows: no card behind them. Poster left, title + date, money right;
    // rows are separated by space alone (no hairlines, no fills).
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
      marginBottom: 8,
    },
    poster: {
      width: 60,
      aspectRatio: 4 / 5,
      borderRadius: radius.poster,
      overflow: 'hidden',
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    rowMeta: {
      marginTop: 4,
      fontSize: 14,
      color: colors.textSecondary,
    },
    rowRight: {
      alignItems: 'flex-end',
      maxWidth: 140,
    },
    rowNet: {
      fontSize: 16,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      color: colors.text,
    },
    rowChip: {
      marginTop: 6,
      alignItems: 'flex-end',
    },
    payoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      marginBottom: 12,
    },
    payoutIcon: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
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
