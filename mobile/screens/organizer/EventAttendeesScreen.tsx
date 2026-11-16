import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { readPersisted, writePersisted, deletePersisted } from '../../lib/persistentCache';
import { dropQueuedCheckIn, postCheckIn, postUndoCheckIn, type UndoCheckInReason } from '../../lib/doorCheckIn';
import type { DoorVerdict } from '../../lib/doorList';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLocaleFormat } from '../../lib/format';
import ExportAttendeesButton from '../../components/ExportAttendeesButton';
import { SPACING, RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import EmptyState from '../../components/EmptyState';
import MoneyText from '../../components/MoneyText';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { Users } from 'lucide-react-native';

type RouteParams = {
  EventAttendees: {
    eventId: string;
  };
};

interface Attendee {
  id: string;
  attendee_name: string;
  attendee_email: string;
  tier_name: string;
  price_paid: number;
  currency?: string;
  purchased_at: any;
  checked_in_at: any;
  checked_in?: boolean;
  status: string;
}

/** A ticket is checked in if any of the three signals say so. */
const isCheckedIn = (a: Attendee): boolean =>
  !!a.checked_in_at || a.checked_in === true || String(a.status || '').toLowerCase() === 'checked_in';

/**
 * Live = valid | confirmed | active (plus legacy tickets with no status, and
 * the old 'checked_in' status, which was a live ticket at the door). The same
 * rule the scanner and the server's check-in use. Refunded, cancelled, voided
 * tickets are listed but never counted or offered a check-in.
 */
const isLive = (a: Attendee): boolean => {
  const s = String(a.status ?? '').trim().toLowerCase();
  return s === '' || s === 'valid' || s === 'confirmed' || s === 'active' || s === 'checked_in';
};

/**
 * Last loaded ticket list per event, kept in memory for this app session only
 * (nothing written to disk). Re-opening the list, or opening it from a
 * notification after it was seen once, renders this instantly while a fresh
 * query runs underneath (TestFlight #195).
 */
const attendeesCache = new Map<string, Attendee[]>();

/** What the list renders, with dates as ISO strings (JSON-safe for the phone copy). */
function slimAttendee(a: Attendee): Attendee {
  const iso = (v: any) => {
    if (!v) return v;
    const d = typeof v?.toDate === 'function' ? v.toDate() : typeof v?.seconds === 'number' ? new Date(v.seconds * 1000) : new Date(v);
    return isNaN(d?.getTime?.()) ? null : d.toISOString();
  };
  return {
    id: a.id,
    attendee_name: a.attendee_name,
    attendee_email: a.attendee_email,
    tier_name: (a as any).tier_name,
    price_paid: (a as any).price_paid,
    currency: (a as any).currency,
    status: a.status,
    checked_in: a.checked_in,
    checked_in_at: iso(a.checked_in_at),
  } as Attendee;
}

/** Bulk check-in runs this many server check-ins at a time. */
const BULK_CHECK_IN_BATCH = 4;

type CheckInOutcome = 'in' | 'refused' | 'failed';

export default function EventAttendeesScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'EventAttendees'>>();
  const navigation = useNavigation();
  const { eventId } = route.params;

  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const { t } = useI18n();
  const showAlert = useAppAlert();
  const { formatDate } = useLocaleFormat();

  // Cache key includes the signed-in person, so another account on the same
  // device never sees this list; an empty uid means no cache at all.
  const { user } = useAuth();
  const cacheKey = user?.uid ? `${user.uid}:${eventId}` : '';
  const [attendees, setAttendees] = useState<Attendee[]>(() => (cacheKey && attendeesCache.get(cacheKey)) || []);
  const [loading, setLoading] = useState(() => !(cacheKey && attendeesCache.has(cacheKey)));
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked_in' | 'not_checked_in'>('all');
  // Ticket ids with an in-flight check-in write — used to disable the row's
  // button so a double-tap can't fire two check-ins.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  // Coming back to this screen (it stays mounted under the stack) reloads,
  // so a change made elsewhere (an undo, another door) never shows stale.
  const firstFocus = useRef(true);
  // Has the server answered yet / was the last answer a success?
  const serverSettled = useRef(false);
  const serverOk = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      loadAttendees();
    }, [eventId, cacheKey])
  );

  useEffect(() => {
    // Cold start (e.g. opened from a notification): show the last good list
    // from the phone at once, then refresh. Keyed by uid + event.
    if (cacheKey && !attendeesCache.has(cacheKey)) {
      readPersisted<Attendee[]>(`attendees:${cacheKey}`).then((saved) => {
        // Ignored once the server has answered (success OR refusal): a
        // refused load must never be followed by the saved copy (fail closed).
        if (serverSettled.current) return;
        if (saved && saved.length) {
          setAttendees((cur) => (cur.length ? cur : saved));
          setLoading(false);
        }
      });
    }
    loadAttendees();
  }, [eventId]);

  // Keep the session cache (and the on-phone copy) in step with every change.
  useEffect(() => {
    if (!loading && cacheKey) {
      attendeesCache.set(cacheKey, attendees);
      // Only data that came from a successful server load goes to the phone.
      if (serverOk.current) writePersisted(`attendees:${cacheKey}`, attendees.map(slimAttendee));
    }
  }, [attendees, loading, cacheKey]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAttendees();
    setRefreshing(false);
  };

  // Derive the visible list from the source data + filters — no effect/state
  // shadow copy to keep in sync.
  const filteredAttendees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return attendees.filter((a) => {
      if (q && !(
        a.attendee_name?.toLowerCase().includes(q) ||
        a.attendee_email?.toLowerCase().includes(q)
      )) {
        return false;
      }
      if (filterStatus === 'checked_in') return isLive(a) && isCheckedIn(a);
      if (filterStatus === 'not_checked_in') return isLive(a) && !isCheckedIn(a);
      return true;
    });
  }, [attendees, searchQuery, filterStatus]);

  const loadAttendees = async () => {
    serverOk.current = false;
    try {
      const q = query(
        collection(db, 'tickets'),
        where('event_id', '==', eventId)
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Attendee[];

      serverOk.current = true;
      serverSettled.current = true;
      setAttendees(data);
    } catch (error) {
      console.error('Error loading attendees:', error);
      // Fail closed: a refused or failed load (e.g. access removed) must not
      // leave a cached list of names on screen.
      serverSettled.current = true;
      if (cacheKey) {
        attendeesCache.delete(cacheKey);
        deletePersisted(`attendees:${cacheKey}`);
      }
      setAttendees([]);
    } finally {
      setLoading(false);
    }
  };

  /** Why the server refused a check-in, in the scanner's words. */
  const refusalMessage = (verdict: DoorVerdict): string => {
    switch (verdict) {
      case 'ALREADY_CHECKED_IN':
        return t('organizerTicketScanner.results.alreadyCheckedIn');
      case 'EXPIRED':
        return t('organizerTicketScanner.results.expired');
      case 'CANCELLED':
        return t('organizerTicketScanner.results.cancelled');
      case 'WRONG_EVENT':
        return t('organizerTicketScanner.results.wrongEvent');
      case 'NOT_FOUND':
        return t('organizerTicketScanner.results.notFound');
      case 'OUTSIDE_WINDOW':
        return t('organizerAttendees.outsideWindow');
      default:
        return t('organizerAttendees.checkInFailed');
    }
  };

  // Manual check-in for staff when the camera can't read a damaged/screenshot
  // QR. Goes through the same server check-in the scanner uses (a Firestore
  // transaction that re-checks status, expiry and "already in"), so this list
  // and a scanner on another phone can never both admit one ticket. Optimistic
  // local update, reverted if the server refuses or cannot be reached.
  // `silent` skips the per-ticket alert (bulk check-in reports one total).
  const checkInAttendee = async (attendee: Attendee, silent = false): Promise<CheckInOutcome> => {
    // Optimistic: flip the row to checked-in immediately and mark the
    // ticket pending so the button is disabled while we write.
    setPendingIds((prev) => new Set(prev).add(attendee.id));
    setAttendees((prev) =>
      prev.map((a) =>
        a.id === attendee.id
          ? { ...a, checked_in: true, checked_in_at: new Date(), status: 'checked_in' }
          : a
      )
    );

    const revert = () =>
      setAttendees((prev) =>
        prev.map((a) =>
          a.id === attendee.id
            ? {
                ...a,
                checked_in: attendee.checked_in,
                checked_in_at: attendee.checked_in_at,
                status: attendee.status,
              }
            : a
        )
      );

    try {
      // Picked off the attendee list by hand, NOT a scan: payout review
      // reads check_in_method.
      const res = await postCheckIn(eventId, { ticketId: attendee.id, method: 'manual' });
      if (res.verdict === 'CHECKED_IN' || (res.verdict === 'ALREADY_CHECKED_IN' && res.mine)) return 'in';
      // Refused on the server's re-check. If it is already in (another
      // door got there first), keep it shown as checked in.
      if (res.verdict === 'ALREADY_CHECKED_IN') {
        const at = res.row?.checkedInAt ? new Date(res.row.checkedInAt) : new Date();
        setAttendees((prev) =>
          prev.map((a) => (a.id === attendee.id ? { ...a, checked_in: true, checked_in_at: at } : a))
        );
      } else {
        revert();
      }
      if (!silent) showAlert(refusalMessage(res.verdict));
      return 'refused';
    } catch (error) {
      console.error('Error checking in attendee:', error);
      // Revert the optimistic change to the exact prior values.
      revert();
      if (!silent) showAlert(t('organizerAttendees.checkInFailed'));
      return 'failed';
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(attendee.id);
        return next;
      });
    }
  };

  const handleManualCheckIn = (attendee: Attendee) => {
    if (bulkRunning || pendingIds.has(attendee.id) || isCheckedIn(attendee) || !isLive(attendee)) return;

    const name = attendee.attendee_name || attendee.attendee_email || t('common.attendee');

    showAlert(
      t('organizerAttendees.checkInConfirmTitle'),
      t('organizerAttendees.checkInConfirmBody').replace('{name}', name),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('organizerAttendees.checkIn'),
          onPress: () => {
            void checkInAttendee(attendee);
          },
        },
      ]
    );
  };

  // Undo a check-in: tap the green check. One tap on a reason both confirms
  // and records why (the server keeps who/when/why; check-ins feed payouts).
  const undoCheckIn = async (attendee: Attendee, reason: UndoCheckInReason) => {
    setPendingIds((prev) => new Set(prev).add(attendee.id));
    try {
      const ok = await postUndoCheckIn(eventId, attendee.id, reason);
      if (!ok) throw new Error('undo_refused');
      if (user?.uid) await dropQueuedCheckIn(user.uid, eventId, attendee.id);
      setAttendees((prev) =>
        prev.map((a) =>
          a.id === attendee.id
            ? {
                ...a,
                checked_in: false,
                checked_in_at: null as any,
                status: String(a.status || '').toLowerCase() === 'checked_in' ? 'valid' : a.status,
              }
            : a
        )
      );
    } catch (error) {
      console.error('Error undoing check-in:', error);
      showAlert(t('organizerAttendees.undoFailed'));
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(attendee.id);
        return next;
      });
    }
  };

  const handleUndoCheckIn = (attendee: Attendee) => {
    const name = attendee.attendee_name || attendee.attendee_email || t('common.general');
    showAlert(t('organizerAttendees.undoTitle').replace('{name}', name), '', [
      { text: t('organizerAttendees.undoReasons.mistake'), onPress: () => undoCheckIn(attendee, 'mistake') },
      { text: t('organizerAttendees.undoReasons.wrong_person'), onPress: () => undoCheckIn(attendee, 'wrong_person') },
      { text: t('organizerAttendees.undoReasons.testing'), onPress: () => undoCheckIn(attendee, 'testing') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  // "Check in all" on the not-checked-in filter: every live ticket not yet in,
  // through the same server check-in as one row, a few at a time, then one
  // total.
  const handleCheckInAll = () => {
    if (bulkRunning) return;
    const targets = attendees.filter((a) => isLive(a) && !isCheckedIn(a) && !pendingIds.has(a.id));
    if (targets.length === 0) return;
    const count = String(targets.length);

    showAlert(
      t('organizerAttendees.checkInAll'),
      t('organizerAttendees.checkInAllConfirm').replace('{count}', count),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('organizerAttendees.checkIn'),
          onPress: async () => {
            setBulkRunning(true);
            let done = 0;
            try {
              for (let i = 0; i < targets.length; i += BULK_CHECK_IN_BATCH) {
                const batch = targets.slice(i, i + BULK_CHECK_IN_BATCH);
                const results = await Promise.all(batch.map((a) => checkInAttendee(a, true)));
                done += results.filter((r) => r === 'in').length;
              }
            } finally {
              setBulkRunning(false);
            }
            showAlert(
              done === targets.length
                ? t('organizerAttendees.checkInAllDone').replace('{count}', String(done))
                : t('organizerAttendees.checkInAllPartial')
                    .replace('{done}', String(done))
                    .replace('{count}', count)
            );
          },
        },
      ]
    );
  };

  // One plain list row per attendee (owner, 2026-11-16: "it should be a
  // list, why is each name a card?"). Name, then tier and email on one quiet
  // line — never "N/A" or a 0 HTG price on a free ticket — and the door state
  // on the right: a check + time once in, a small Check in button before.
  const renderAttendee = ({ item }: { item: Attendee }) => {
    const checkedIn = isCheckedIn(item);
    const live = isLive(item);
    const pending = pendingIds.has(item.id);
    const paid = Number(item.price_paid) > 0;
    const sub = [item.tier_name, item.attendee_email].filter(Boolean).join(' · ');

    return (
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={[styles.attendeeName, !live && styles.rowMuted]} numberOfLines={1}>
            {item.attendee_name || item.attendee_email || t('common.general')}
          </Text>
          {(!!sub || paid) && (
            <Text style={styles.rowSub} numberOfLines={1}>
              {sub}
              {paid ? (
                <>
                  {sub ? ' · ' : ''}
                  <MoneyText amount={item.price_paid || 0} currency={item.currency as any} style={styles.rowSub} />
                </>
              ) : null}
            </Text>
          )}
        </View>

        {!live ? (
          <Text style={styles.rowStateMuted}>{t('organizerAttendees.status.notValid')}</Text>
        ) : checkedIn ? (
          <Touchable
            style={styles.rowState}
            onPress={() => handleUndoCheckIn(item)}
            disabled={pending || bulkRunning}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('organizerAttendees.undoTitle').replace(
              '{name}',
              item.attendee_name || item.attendee_email || ''
            )}
          >
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            {!!item.checked_in_at && (
              <Text style={styles.rowStateText}>{formatDate(item.checked_in_at, 'h:mm a')}</Text>
            )}
          </Touchable>
        ) : (
          <Touchable
            style={[styles.checkInButton, (pending || bulkRunning) && styles.checkInButtonDisabled]}
            onPress={() => handleManualCheckIn(item)}
            disabled={pending || bulkRunning}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || bulkRunning }}
          >
            <Text style={styles.checkInButtonText}>{t('organizerAttendees.checkIn')}</Text>
          </Touchable>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Identical header to the loaded branch — no in-flow -> overlay flash. */}
        <OrganizerScreenHeader title={t('organizerAttendees.headerTitle')} onBack={() => navigation.goBack()} overlay onHeight={onHeight} />
        <View style={{ padding: SPACING.lg, marginTop: headerH }}>
          {/* Mirrors the loaded order: stats bar, search field, filter tabs,
              then attendee cards — five identical 132pt slabs matched nothing. */}
          <Skeleton width="100%" height={64} radius={RADIUS.md} style={{ marginBottom: SPACING.md }} />
          <Skeleton width="100%" height={44} radius={RADIUS.md} style={{ marginBottom: SPACING.md }} />
          <Skeleton width="70%" height={32} radius={RADIUS.md} style={{ marginBottom: SPACING.md }} />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={48} radius={RADIUS.sm} style={{ marginBottom: SPACING.md }} />
          ))}
        </View>
      </View>
    );
  }

  // Live tickets only: a refunded or cancelled ticket is not an attendee.
  const liveAttendees = attendees.filter(isLive);
  const liveCount = liveAttendees.length;
  const checkedInCount = liveAttendees.filter(isCheckedIn).length;
  const notCheckedInCount = liveCount - checkedInCount;

  return (
    <View style={styles.container}>
      {/* Header */}
      <OrganizerScreenHeader
        title={t('organizerAttendees.headerTitle')}
        onBack={() => navigation.goBack()}
        right={<ExportAttendeesButton eventId={eventId} attendees={attendees} />}
        overlay
        onHeight={onHeight}
      />

      {/* Stats Bar — the first static block under the floating header, so it
          carries the reserved height for the search + tabs + list beneath it. */}
      <View style={[styles.statsBar, { marginTop: headerH }]}>
        <Text style={styles.statsBarText}>
          {checkedInCount}/{liveCount} {t('organizerAttendees.headerCheckedInSuffix')}
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('organizerAttendees.searchPlaceholder')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterTabsWrap}>
        <SegmentedTabs
          value={filterStatus}
          onChange={(key) => setFilterStatus(key as 'all' | 'checked_in' | 'not_checked_in')}
          tabs={[
            { key: 'all', label: t('organizerAttendees.filters.all'), count: attendees.length },
            { key: 'checked_in', label: t('organizerAttendees.filters.checkedIn'), count: checkedInCount },
            { key: 'not_checked_in', label: t('organizerAttendees.filters.notCheckedIn'), count: notCheckedInCount },
          ]}
        />
      </View>

      {/* Attendees list */}
      <FlatList
        data={filteredAttendees}
        ListHeaderComponent={
          filterStatus === 'not_checked_in' && notCheckedInCount > 0 && !searchQuery ? (
            <View style={styles.bulkRow}>
              <Touchable
                onPress={handleCheckInAll}
                disabled={bulkRunning}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ disabled: bulkRunning, busy: bulkRunning }}
                style={bulkRunning ? styles.checkInButtonDisabled : undefined}
              >
                <Text style={styles.bulkText}>
                  {t('organizerAttendees.checkInAll')} ({notCheckedInCount})
                </Text>
              </Touchable>
            </View>
          ) : null
        }
        renderItem={renderAttendee}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon={Users}
            title={searchQuery ? t('organizerAttendees.empty.filtered') : t('organizerAttendees.empty.default')}
          />
        }
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  statsBarText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    margin: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: colors.text,
  },
  filterTabsWrap: {
    marginBottom: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  attendeeName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  rowMuted: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  rowSub: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowStateText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  rowStateMuted: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  // A raised fill on the card's surface, not an outlined box.
  checkInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: colors.surfaceRaised,
  },
  bulkRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  bulkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  checkInButtonDisabled: {
    opacity: 0.45,
  },
  checkInButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
});
