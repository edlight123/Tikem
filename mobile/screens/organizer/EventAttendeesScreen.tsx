import React, { useState, useEffect, useMemo } from 'react';
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
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { postCheckIn } from '../../lib/doorCheckIn';
import type { DoorVerdict } from '../../lib/doorList';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import ExportAttendeesButton from '../../components/ExportAttendeesButton';
import { SPACING, RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusChip from '../../components/StatusChip';
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

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked_in' | 'not_checked_in'>('all');
  // Ticket ids with an in-flight check-in write — used to disable the row's
  // button so a double-tap can't fire two check-ins.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAttendees();
  }, [eventId]);

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

      setAttendees(data);
    } catch (error) {
      console.error('Error loading attendees:', error);
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
  const handleManualCheckIn = (attendee: Attendee) => {
    if (pendingIds.has(attendee.id) || isCheckedIn(attendee) || !isLive(attendee)) return;

    const name = attendee.attendee_name || attendee.attendee_email || t('common.attendee');

    showAlert(
      t('organizerAttendees.checkInConfirmTitle'),
      t('organizerAttendees.checkInConfirmBody').replace('{name}', name),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('organizerAttendees.checkIn'),
          onPress: async () => {
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
              if (res.verdict === 'CHECKED_IN' || (res.verdict === 'ALREADY_CHECKED_IN' && res.mine)) return;
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
              showAlert(refusalMessage(res.verdict));
            } catch (error) {
              console.error('Error checking in attendee:', error);
              // Revert the optimistic change to the exact prior values.
              revert();
              showAlert(t('organizerAttendees.checkInFailed'));
            } finally {
              setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(attendee.id);
                return next;
              });
            }
          },
        },
      ]
    );
  };

  const renderAttendee = ({ item }: { item: Attendee }) => {
    const checkedIn = isCheckedIn(item);
    const live = isLive(item);
    const pending = pendingIds.has(item.id);

    return (
      <View style={styles.attendeeCard}>
        <View style={styles.attendeeHeader}>
          <View style={styles.attendeeInfo}>
            <Text style={styles.attendeeName} numberOfLines={1}>{item.attendee_name || t('common.na')}</Text>
            <Text style={styles.attendeeEmail} numberOfLines={1}>{item.attendee_email || t('common.na')}</Text>
          </View>
          {live ? (
            <StatusChip
              status={checkedIn ? 'success' : 'pending'}
              label={checkedIn ? t('organizerAttendees.status.checkedIn') : t('organizerAttendees.status.notCheckedIn')}
            />
          ) : (
            <StatusChip status="neutral" label={t('organizerAttendees.status.notValid')} />
          )}
        </View>

        <View style={styles.attendeeDetails}>
          <View style={styles.detailRow}>
            <Ionicons name="ticket-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.detailText}>{item.tier_name || t('common.general')}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
            <MoneyText amount={item.price_paid || 0} currency={item.currency as any} style={styles.priceText} />
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.detailText}>
              {formatDate(item.purchased_at)}
            </Text>
          </View>
        </View>

        {live && checkedIn && item.checked_in_at && (
          <View style={styles.checkedInInfo}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <Text style={styles.checkedInText}>
              {t('organizerAttendees.checkedInPrefix')}{formatDate(item.checked_in_at, 'MMM d, yyyy • h:mm a')}
            </Text>
          </View>
        )}

        {live && !checkedIn && (
          <TouchableOpacity
            style={[styles.checkInButton, pending && styles.checkInButtonDisabled]}
            onPress={() => handleManualCheckIn(item)}
            disabled={pending}
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.text} />
            <Text style={styles.checkInButtonText}>{t('organizerAttendees.checkIn')}</Text>
          </TouchableOpacity>
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
            <Skeleton key={i} width="100%" height={96} radius={RADIUS.lg} style={{ marginBottom: SPACING.md }} />
          ))}
        </View>
      </View>
    );
  }

  // Live tickets only: a refunded or cancelled ticket is not an attendee.
  const liveAttendees = attendees.filter(isLive);
  const liveCount = liveAttendees.length;
  const checkedInCount = liveAttendees.filter(isCheckedIn).length;

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
            { key: 'not_checked_in', label: t('organizerAttendees.filters.notCheckedIn'), count: liveCount - checkedInCount },
          ]}
        />
      </View>

      {/* Attendees list */}
      <FlatList
        data={filteredAttendees}
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
    backgroundColor: colors.surfaceMuted,
    margin: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
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
  attendeeCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  attendeeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  attendeeInfo: {
    flex: 1,
    marginRight: 12,
  },
  attendeeName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  attendeeEmail: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  attendeeDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  priceText: {
    fontSize: 14,
    marginLeft: 4,
    color: colors.textSecondary,
  },
  checkedInInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  checkedInText: {
    fontSize: 12,
    color: colors.success,
    marginLeft: 4,
  },
  checkInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  checkInButtonDisabled: {
    opacity: 0.45,
  },
  checkInButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
