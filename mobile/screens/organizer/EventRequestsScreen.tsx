// Organizer "Requests" for one approval-list event: who asked to join, with
// their plus-ones and note; approve or decline one by one, or approve all.
// Built to Stitch screen 668ea553341444c7b0fefa1f19173533 (project
// 7258845792079223737). Spec: docs/specs/approval-lists-and-plus-ones.md.
//
// attend_requests has no client rules: everything goes through
// /api/organizer/events/{id}/requests (backendJson attaches the token).

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from '../../components/AppAlert';
import { useI18n } from '../../contexts/I18nContext';
import { Skeleton } from '../../components/Skeleton';
import WhitePillCTA from '../../components/WhitePillCTA';
import PersonAvatar from '../../components/PersonAvatar';
import RequestStatusDot, { requestTone } from '../../components/RequestStatusDot';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { getEventById } from '../../lib/api/organizer';
import { AFTER_ALERT_MS } from '../../lib/moderationActions';
import {
  approveAllEventRequests,
  attendErrorKey,
  decideEventRequest,
  getEventRequests,
  type OrganizerAttendRequest,
  type OrganizerRequestsResponse,
} from '../../lib/attendRequests';
import { colors as T, font, radius, spacing } from '../../theme/tokens';

type RouteParams = { EventRequests: { eventId: string } };
type Tab = 'pending' | 'approved' | 'declined';

const STOP_CODES = new Set(['no_tickets_available', 'limited_availability', 'tier_sold_out']);

export default function EventRequestsScreen() {
  const route = useRoute<RouteProp<RouteParams, 'EventRequests'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const { t } = useI18n();
  const showAlert = useAppAlert();

  const [eventTitle, setEventTitle] = useState('');
  const [data, setData] = useState<OrganizerRequestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [approvingAll, setApprovingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [event, res] = await Promise.all([getEventById(eventId), getEventRequests(eventId)]);
      setEventTitle(event?.title || '');
      setData(res);
    } catch {
      showAlert(t('common.error'), t('attendRequests.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [eventId, showAlert, t]);

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

  const counts = data?.counts || { pending: 0, approved: 0, declined: 0 };
  const rows = useMemo(
    () =>
      (data?.requests || []).filter((r) =>
        tab === 'pending' ? r.status === 'pending' || r.status === 'approving' : r.status === tab
      ),
    [data, tab]
  );

  const errorText = (code?: string | null) => t(`attendRequests.errors.${attendErrorKey(code)}`);

  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const decide = async (r: OrganizerAttendRequest, action: 'approve' | 'decline') => {
    if (busyIds.has(r.id) || approvingAll) return;
    markBusy(r.id, true);
    try {
      await decideEventRequest(eventId, r.id, action);
    } catch (err: any) {
      // Chained after a confirm alert on decline: let it finish dismissing.
      setTimeout(() => showAlert(t('common.error'), errorText(err?.code)), action === 'decline' ? AFTER_ALERT_MS : 0);
    } finally {
      markBusy(r.id, false);
      load();
    }
  };

  const confirmDecline = (r: OrganizerAttendRequest) => {
    showAlert(
      t('attendRequests.organizer.declineTitle', { name: r.name || t('attendRequests.organizer.guestFallback') }),
      t('attendRequests.organizer.declineBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('attendRequests.organizer.decline'), style: 'destructive', onPress: () => decide(r, 'decline') },
      ]
    );
  };

  const confirmApproveAll = () => {
    if (approvingAll || counts.pending === 0) return;
    showAlert(t('attendRequests.organizer.approveAllTitle'), t('attendRequests.organizer.approveAllBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('attendRequests.organizer.approveAll', { count: counts.pending }),
        onPress: async () => {
          setApprovingAll(true);
          try {
            const res = await approveAllEventRequests(eventId);
            const soldOut = res.stoppedBecause && STOP_CODES.has(res.stoppedBecause);
            setTimeout(
              () =>
                showAlert(
                  t('attendRequests.organizer.title'),
                  [
                    t('attendRequests.organizer.approveAllDone', { approved: res.approved, failed: res.failed }),
                    soldOut ? t('attendRequests.organizer.approveAllSoldOut') : '',
                  ]
                    .filter(Boolean)
                    .join('\n')
                ),
              AFTER_ALERT_MS
            );
          } catch (err: any) {
            setTimeout(() => showAlert(t('common.error'), errorText(err?.code)), AFTER_ALERT_MS);
          } finally {
            setApprovingAll(false);
            load();
          }
        },
      },
    ]);
  };

  const ago = (iso: string | null) => {
    const ms = iso ? Date.now() - Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return t('attendRequests.organizer.justNow');
    if (min < 60) return t('attendRequests.organizer.minutesAgo', { count: min });
    const h = Math.floor(min / 60);
    if (h < 24) return t('attendRequests.organizer.hoursAgo', { count: h });
    return t('attendRequests.organizer.daysAgo', { count: Math.floor(h / 24) });
  };

  const statusLabel = (status: string) =>
    status === 'approved'
      ? t('attendRequests.organizer.statusApproved')
      : status === 'declined'
        ? t('attendRequests.organizer.statusDeclined')
        : t('attendRequests.organizer.statusPending');

  const renderRow = ({ item }: { item: OrganizerAttendRequest }) => {
    const busy = busyIds.has(item.id) || item.status === 'approving' || approvingAll;
    const pending = item.status === 'pending' || item.status === 'approving';
    const plusLine =
      item.plus_ones.length > 0
        ? t('attendRequests.organizer.plusOnes', {
            count: item.plus_ones.length,
            names: item.plus_ones.map((p) => (p.phone ? `${p.first_name} · ${p.phone}` : p.first_name)).join(', '),
          })
        : t('attendRequests.organizer.solo');
    return (
      <View style={styles.row}>
        <View style={styles.rowTop}>
          <PersonAvatar
            user={{ uid: item.requester_id, displayName: item.name || item.email, photoURL: item.avatar_url || undefined } as any}
            size={44}
          />
          <View style={styles.rowBody}>
            <View style={styles.nameLine}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name || item.email || t('attendRequests.organizer.guestFallback')}
              </Text>
              <Text style={styles.time}>{ago(item.created_at)}</Text>
            </View>
            <Text style={styles.plusLine} numberOfLines={2}>
              {plusLine}
            </Text>
          </View>
          <RequestStatusDot tone={requestTone(item.status)} label={statusLabel(item.status)} />
        </View>
        {!!item.note && <Text style={styles.note}>“{item.note}”</Text>}
        {pending && !!item.last_error && (
          <Text style={styles.lastError}>
            {t('attendRequests.organizer.lastError', { reason: errorText(item.last_error) })}
          </Text>
        )}
        {pending && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.declineBtn, busy && styles.dim]}
              onPress={() => confirmDecline(item)}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.declineText}>{t('attendRequests.organizer.decline')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.approveBtn, busy && styles.dim]}
              onPress={() => decide(item, 'approve')}
              disabled={busy}
              accessibilityRole="button"
            >
              {busyIds.has(item.id) ? (
                <ActivityIndicator color={T.onWhite} />
              ) : (
                <Text style={styles.approveText}>{t('attendRequests.organizer.approve')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const header = (
    <OrganizerScreenHeader
      title={t('attendRequests.organizer.title')}
      subtitle={eventTitle || undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH + spacing.lg, paddingHorizontal: spacing.lg }}>
          <Skeleton width="60%" height={16} radius={radius.sm} />
          <Skeleton width="100%" height={44} radius={radius.md} style={{ marginTop: spacing.lg }} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={150} radius={radius.md} style={{ marginTop: spacing.md }} />
          ))}
        </View>
      </View>
    );
  }

  const emptyText =
    tab === 'pending'
      ? t('attendRequests.organizer.emptyPending')
      : tab === 'approved'
        ? t('attendRequests.organizer.emptyApproved')
        : t('attendRequests.organizer.emptyDeclined');

  return (
    <View style={styles.container}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderRow}
        contentContainerStyle={{
          paddingTop: headerH + spacing.lg,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + 32,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.textPrimary} progressViewOffset={headerH} />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.stats}>
              {t('attendRequests.organizer.stats', {
                pending: counts.pending,
                approved: counts.approved,
                declined: counts.declined,
              })}
            </Text>
            {data && !data.requiresApproval && (
              <Text style={styles.notice}>{t('attendRequests.organizer.notEnabled')}</Text>
            )}
            <View style={styles.tabs}>
              <SegmentedTabs
                value={tab}
                onChange={(key) => setTab(key as Tab)}
                tabs={[
                  { key: 'pending', label: t('attendRequests.organizer.tabPending'), count: counts.pending },
                  { key: 'approved', label: t('attendRequests.organizer.tabApproved'), count: counts.approved },
                  { key: 'declined', label: t('attendRequests.organizer.tabDeclined'), count: counts.declined },
                ]}
              />
            </View>
            {tab === 'pending' && counts.pending > 0 && (
              <WhitePillCTA
                label={t('attendRequests.organizer.approveAll', { count: counts.pending })}
                onPress={confirmApproveAll}
                loading={approvingAll}
                style={{ marginBottom: spacing.lg }}
              />
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyText}</Text>
            <Text style={styles.emptyHint}>{t('attendRequests.organizer.emptyHint')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  stats: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: T.textSecondary,
  },
  notice: { marginTop: spacing.md, fontSize: 13, lineHeight: 18, color: T.amber },
  tabs: { marginTop: spacing.lg, marginBottom: spacing.lg },
  // A fill, never a ring around an empty box.
  row: { backgroundColor: T.surface, borderRadius: radius.md, padding: spacing.lg },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowBody: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: T.textPrimary },
  time: { fontSize: 12, color: T.textTertiary },
  plusLine: { marginTop: 4, fontSize: 14, color: T.textSecondary },
  note: { marginTop: spacing.md, fontSize: 14, lineHeight: 20, fontStyle: 'italic', color: T.textSecondary },
  lastError: { marginTop: spacing.sm, fontSize: 12, color: T.red },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  declineBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.button,
    backgroundColor: T.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  approveBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.button,
    backgroundColor: T.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { fontSize: 15, fontWeight: '700', color: T.onWhite },
  dim: { opacity: 0.45 },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyTitle: { fontFamily: font.serif, fontSize: 22, color: T.textPrimary },
  emptyHint: { marginTop: spacing.sm, fontSize: 13, color: T.textSecondary, textAlign: 'center' },
});
