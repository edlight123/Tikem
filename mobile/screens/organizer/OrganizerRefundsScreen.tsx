import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { radius } from '../../theme/tokens';
import { useAppAlert } from '../../components/AppAlert';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { backendFetch } from '../../lib/api/backend';
import { useLocaleFormat } from '../../lib/format';
import { RADIUS } from '../../config/brand';
import EmptyState from '../../components/EmptyState';
import StatusChip from '../../components/StatusChip';
import { Skeleton } from '../../components/Skeleton';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { Receipt } from 'lucide-react-native';
import { safeFormatForLanguage } from '../../lib/dates';

interface RefundRequest {
  id: string;
  ticket_id: string;
  event_title: string;
  attendee_email: string;
  attendee_name: string;
  amount: number;
  /** Currency of the refund amount (event/ticket currency). Optional — defaults to the Haiti-first HTG. */
  currency?: string;
  reason: string;
  requested_at: string;
  status: 'requested' | 'approved' | 'denied' | 'under_review';
}

export default function OrganizerRefundsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const showAlert = useAppAlert();
  const { formatMoney } = useLocaleFormat();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processed'>('pending');

  const loadData = useCallback(async () => {
    if (!userProfile?.id) return;

    try {
      const response = await backendFetch('/api/organizer/refunds');
      
      if (response.ok) {
        const data = await response.json();
        setRefundRequests(data.refunds || []);
      } else {
        // Fallback: Load from Firebase
        await loadFromFirebase();
      }
    } catch (error) {
      console.error('Error loading refunds:', error);
      await loadFromFirebase();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userProfile?.id]);

  const loadFromFirebase = async () => {
    try {
      // Get organizer's events
      const eventsQuery = query(
        collection(db, 'events'),
        where('organizer_id', '==', userProfile?.id)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      const eventIds = eventsSnapshot.docs.map(doc => doc.id);
      const eventsMap = new Map(eventsSnapshot.docs.map(doc => [doc.id, doc.data()]));

      if (eventIds.length === 0) {
        setRefundRequests([]);
        return;
      }

      // Get tickets with refund requests. Batch the per-event ticket queries by
      // chunking eventIds into `event_id in [...]` queries instead of issuing one
      // query per event (N+1). Firestore caps a query at 30 disjunctions across
      // all `in` filters, and refund_status contributes 5, so keep each
      // event_id chunk at <=6 (6 x 5 = 30).
      // 'manual_required' is an APPROVED mobile-money refund waiting on the
      // admin payout queue, shown as approved. 'admin_review' is an approved
      // refund the remaining balance didn't cover, waiting on Tikèm.
      const REFUND_STATUSES = ['requested', 'approved', 'denied', 'manual_required', 'admin_review'];
      const EVENT_CHUNK = 6;
      const requests: RefundRequest[] = [];
      for (let i = 0; i < eventIds.length; i += EVENT_CHUNK) {
        const chunk = eventIds.slice(i, i + EVENT_CHUNK);
        const ticketsQuery = query(
          collection(db, 'tickets'),
          where('event_id', 'in', chunk),
          where('refund_status', 'in', REFUND_STATUSES)
        );
        const ticketsSnapshot = await getDocs(ticketsQuery);

        ticketsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          const event = eventsMap.get(data.event_id);
          requests.push({
            id: doc.id,
            ticket_id: doc.id,
            event_title: (event as any)?.title || 'Unknown Event',
            attendee_email: data.attendee_email || '',
            attendee_name: data.attendee_name || '',
            amount: data.price_paid || data.price || 0,
            currency: (event as any)?.currency || data.currency || undefined,
            reason: data.refund_reason || '',
            requested_at: data.refund_requested_at || data.created_at,
            status:
              data.refund_status === 'manual_required'
                ? 'approved'
                : data.refund_status === 'admin_review'
                ? 'under_review'
                : data.refund_status,
          });
        });
      }

      // Sort by request date (newest first)
      requests.sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime());
      setRefundRequests(requests);
    } catch (error) {
      console.error('Error loading from Firebase:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleProcessRefund = async (ticketId: string, action: 'approve' | 'deny') => {
    showAlert(
      action === 'approve' 
        ? (t('refunds.approveTitle') || 'Approve Refund')
        : (t('refunds.denyTitle') || 'Deny Refund'),
      action === 'approve'
        ? (t('refunds.approveBody') || 'This will initiate a refund to the customer. Continue?')
        : (t('refunds.denyBody') || 'Are you sure you want to deny this refund request?'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm') || 'Confirm',
          style: action === 'deny' ? 'destructive' : 'default',
          onPress: async () => {
            setProcessing(ticketId);
            try {
              const response = await backendFetch('/api/refunds/process', {
                method: 'POST',
                body: JSON.stringify({
                  ticketId,
                  action,
                }),
              });

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || 'Failed to process refund');
              }

              showAlert(
                t('common.success'),
                response.status === 202
                  ? t('refunds.sentForReview')
                  : action === 'approve'
                  ? (t('refunds.approvedSuccess') || 'Refund approved and processed')
                  : (t('refunds.deniedSuccess') || 'Refund request denied')
              );

              // Reload data
              loadData();
            } catch (error: any) {
              console.error('Error processing refund:', error);
              showAlert(t('common.error'), error.message || 'Failed to process refund');
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  const filteredRequests = refundRequests.filter(r => {
    if (filter === 'pending') return r.status === 'requested';
    if (filter === 'processed') return r.status !== 'requested';
    return true;
  });

  const pendingCount = refundRequests.filter(r => r.status === 'requested').length;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('refunds.title') || 'Refund Requests'}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        {/* The tabs row reserves the floating header's height, like when loaded. */}
        <View style={[styles.tabsWrap, { marginTop: headerH }]}>
          <View style={styles.tabsSkeletonRow}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width={92} height={36} radius={999} />
            ))}
          </View>
        </View>
        {/* Request cards: title+chip header, three detail rows, reason box,
            and the approve/deny action row. */}
        {[0, 1].map((i) => (
          <View key={i} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Skeleton width="55%" height={16} radius={6} />
              <Skeleton width={70} height={22} radius={11} />
            </View>
            <View style={styles.requestDetails}>
              {['62%', '38%', '52%'].map((w, j) => (
                <Skeleton key={j} width={w as `${number}%`} height={16} radius={6} />
              ))}
            </View>
            <Skeleton width="100%" height={58} radius={radius.sm} style={{ marginTop: 12 }} />
            <View style={styles.actionButtons}>
              <Skeleton height={44} radius={radius.sm} style={{ flex: 1 }} />
              <Skeleton height={44} radius={radius.sm} style={{ flex: 1 }} />
            </View>
          </View>
        ))}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <OrganizerScreenHeader
        title={t('refunds.title') || 'Refund Requests'}
        onBack={() => navigation.goBack()}
        right={
          pendingCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingCount}</Text>
            </View>
          ) : undefined
        }
        overlay
        onHeight={onHeight}
      />

      {/* Filter Tabs — neutral segmented emphasis, no teal fill.
          The tabs are static, so THEY carry the floating header's reserved
          height; the list below is untouched. */}
      <View style={[styles.tabsWrap, { marginTop: headerH }]}>
        <SegmentedTabs
          tabs={[
            { key: 'pending', label: t('refunds.pending') || 'Pending', count: pendingCount > 0 ? pendingCount : undefined },
            { key: 'processed', label: t('refunds.processed') || 'Processed' },
            { key: 'all', label: t('refunds.all') || 'All' },
          ]}
          value={filter}
          onChange={(k: string) => setFilter(k as 'all' | 'pending' | 'processed')}
        />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {filteredRequests.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filter === 'pending'
              ? (t('refunds.noPending') || 'No pending requests')
              : (t('refunds.noRequests') || 'No refund requests')}
            subtitle={t('refunds.emptyDescription') || 'Refund requests from attendees will appear here'}
          />
        ) : (
          filteredRequests.map((request) => (
            <View key={request.id} style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <Text style={styles.eventTitle} numberOfLines={1}>{request.event_title}</Text>
                <StatusChip
                  status={
                    request.status === 'requested'
                      ? 'actionNeeded'
                      : request.status === 'under_review'
                      ? 'pending'
                      : request.status === 'approved'
                      ? 'success'
                      : 'error'
                  }
                  label={
                    request.status === 'requested'
                      ? (t('refunds.statusPending') || 'Pending')
                      : request.status === 'under_review'
                      ? (t('refunds.statusUnderReview') || 'Under review')
                      : request.status === 'approved'
                      ? (t('refunds.statusApproved') || 'Approved')
                      : (t('refunds.statusDenied') || 'Denied')
                  }
                />
              </View>

              <View style={styles.requestDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.detailText} numberOfLines={1}>{request.attendee_name || request.attendee_email}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.detailText}>{formatMoney(request.amount, { currency: request.currency })}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.detailText}>
                    {request.requested_at && safeFormatForLanguage(request.requested_at, 'MMM dd, yyyy h:mm a', language)}
                  </Text>
                </View>
              </View>

              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>{t('refunds.reason') || 'Reason'}:</Text>
                <Text style={styles.reasonText}>{request.reason || 'No reason provided'}</Text>
              </View>

              {request.status === 'requested' && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.denyButton]}
                    onPress={() => handleProcessRefund(request.ticket_id, 'deny')}
                    disabled={processing === request.ticket_id}
                  >
                    {processing === request.ticket_id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <>
                        <Ionicons name="close-circle" size={18} color={colors.error} />
                        <Text style={styles.denyButtonText}>{t('refunds.deny') || 'Deny'}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.approveButton]}
                    onPress={() => handleProcessRefund(request.ticket_id, 'approve')}
                    disabled={processing === request.ticket_id}
                  >
                    {processing === request.ticket_id ? (
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color={colors.white} />
                        <Text style={styles.approveButtonText}>{t('refunds.approve') || 'Approve'}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))
        )}

        <View style={{ height: 40 + insets.bottom }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  badge: {
    backgroundColor: colors.error,
    borderRadius: radius.chip,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },
  tabsWrap: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabsSkeletonRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  scrollView: {
    flex: 1,
  },
  requestCard: {
    margin: 16,
    marginBottom: 0,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  eventTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginRight: 8,
  },
  requestDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  reasonBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
  },
  reasonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.sm,
    gap: 6,
  },
  denyButton: {
    backgroundColor: colors.error + '15',
    borderWidth: 1,
    borderColor: colors.error + '30',
  },
  denyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
  approveButton: {
    backgroundColor: colors.success,
  },
  approveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
});
