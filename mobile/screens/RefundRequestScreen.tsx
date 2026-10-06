import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { safeFormatForLanguage } from '../lib/dates';
import { useI18n } from '../contexts/I18nContext';
import { RADIUS } from '../config/brand';
import { backendFetch } from '../lib/api/backend';
import { formatCurrency } from '../lib/currency';
import { radius } from '../theme/tokens';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';

/**
 * First-load placeholder that mirrors the refund form: header, ticket summary
 * card, the reason picker rows, the policy note and the submit pill — so the
 * page does not jump when the ticket resolves.
 */
function RefundRequestSkeleton({ styles }: { styles: ReturnType<typeof getStyles> }) {
  return (
    <View>
      <View style={styles.header}>
        <Skeleton width={24} height={24} radius={radius.sm} />
        <Skeleton width={140} height={20} radius={7} />
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.ticketCard}>
        <Skeleton width={'78%'} height={18} radius={6} />
        <Skeleton width={'62%'} height={14} radius={5} style={{ marginTop: 14 }} />
        <Skeleton width={'44%'} height={14} radius={5} style={{ marginTop: 10 }} />
        <View style={styles.priceRow}>
          <Skeleton width={92} height={14} radius={5} />
          <Skeleton width={72} height={20} radius={7} />
        </View>
      </View>

      <View style={styles.section}>
        <Skeleton width={'60%'} height={16} radius={6} style={{ marginBottom: 12 }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.reasonOption}>
            <Skeleton width={22} height={22} radius={11} />
            <Skeleton width={'55%'} height={15} radius={6} style={{ marginLeft: 12 }} />
          </View>
        ))}
      </View>

      <View style={styles.policyCard}>
        <Skeleton width={20} height={20} radius={10} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Skeleton width={'100%'} height={13} radius={5} />
          <Skeleton width={'82%'} height={13} radius={5} style={{ marginTop: 6 }} />
        </View>
      </View>

      <Skeleton height={56} radius={radius.md} style={{ marginHorizontal: 16, marginTop: 8 }} />
    </View>
  );
}

export default function RefundRequestScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { ticketId } = route.params;
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  // The title bar is a blurred overlay now, so the form beneath reserves its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const showAlert = useAppAlert();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const predefinedReasons = [
    { key: 'schedule_conflict', label: t('refund.reasons.scheduleConflict') || 'Schedule conflict' },
    { key: 'cannot_attend', label: t('refund.reasons.cannotAttend') || "Can't attend anymore" },
    { key: 'bought_wrong', label: t('refund.reasons.boughtWrong') || 'Bought wrong tickets' },
    { key: 'financial', label: t('refund.reasons.financial') || 'Financial reasons' },
    { key: 'other', label: t('refund.reasons.other') || 'Other reason' },
  ];

  useEffect(() => {
    fetchTicketDetails();
  }, [ticketId]);

  const fetchTicketDetails = async () => {
    try {
      const ticketDoc = await getDoc(doc(db, 'tickets', ticketId));
      if (ticketDoc.exists()) {
        const data = ticketDoc.data();
        setTicket({
          id: ticketDoc.id,
          ...data,
          event_date: data.event_date?.toDate ? data.event_date.toDate() : data.event_date ? new Date(data.event_date) : null,
        });
      }
    } catch (error) {
      console.error('Error fetching ticket:', error);
      showAlert(t('common.error'), t('refund.loadError') || 'Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRefund = async () => {
    if (!selectedReason) {
      showAlert(t('common.error'), t('refund.selectReason') || 'Please select a reason');
      return;
    }

    const finalReason = selectedReason === 'other' ? reason : selectedReason;
    if (!finalReason.trim()) {
      showAlert(t('common.error'), t('refund.enterReason') || 'Please provide a reason');
      return;
    }

    setSubmitting(true);
    try {
      const response = await backendFetch('/api/refunds/request', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          reason: finalReason,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit refund request');
      }

      showAlert(
        t('common.success'),
        t('refund.submitted') || 'Refund request submitted. The organizer will review your request.',
        [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      console.error('Error submitting refund:', error);
      showAlert(t('common.error'), error.message || t('refund.submitError') || 'Failed to submit refund request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <RefundRequestSkeleton styles={styles} />
      </SafeAreaView>
    );
  }

  if (!ticket) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{t('refund.ticketNotFound') || 'Ticket not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Check if refund is still allowed (24h before event)
  const eventDate = new Date(ticket.event_date || ticket.start_datetime);
  const now = new Date();
  const refundDeadline = new Date(eventDate);
  refundDeadline.setHours(refundDeadline.getHours() - 24);
  const canRefund = now < refundDeadline;

  return (
    // edges WITHOUT 'top': OverlayHeader pays the notch inset itself, so the
    // chrome runs edge-to-edge behind the status bar rather than starting
    // below a black strip.
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header — a blurred overlay the form scrolls under. */}
      <OverlayHeader onHeight={onHeaderHeight} style={styles.headerBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('refund.title') || 'Request Refund'}</Text>
        <View style={{ width: 40 }} />
      </OverlayHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Ticket Info Card */}
        <View style={styles.ticketCard}>
          <Text style={styles.eventTitle}>{ticket.event_title}</Text>
          <View style={styles.ticketRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.ticketInfo}>
              {ticket.event_date && safeFormatForLanguage(ticket.event_date, 'EEEE, MMMM dd, yyyy', language)}
            </Text>
          </View>
          <View style={styles.ticketRow}>
            <Ionicons name="ticket-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.ticketInfo}>
              {ticket.tier_name || t('refund.generalAdmission') || 'General Admission'}
            </Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>{t('refund.amountPaid') || 'Amount Paid'}:</Text>
            <Text style={styles.priceValue}>
              {formatCurrency(Number(ticket.price_paid || ticket.price || 0), ticket.currency)}
            </Text>
          </View>
        </View>

        {!canRefund ? (
          <View style={styles.warningCard}>
            <Ionicons name="warning" size={24} color={colors.error} />
            <Text style={styles.warningText}>
              {t('refund.deadlinePassed') || 'Refund deadline has passed. Refunds must be requested at least 24 hours before the event.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Reason Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('refund.selectReasonTitle') || 'Why do you need a refund?'}</Text>
              {predefinedReasons.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.reasonOption,
                    selectedReason === item.key && styles.reasonOptionSelected,
                  ]}
                  onPress={() => setSelectedReason(item.key)}
                >
                  <View style={[
                    styles.radioCircle,
                    selectedReason === item.key && styles.radioCircleSelected,
                  ]}>
                    {selectedReason === item.key && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[
                    styles.reasonText,
                    selectedReason === item.key && styles.reasonTextSelected,
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Additional Details */}
            {selectedReason === 'other' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('refund.additionalDetails') || 'Additional Details'}</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={t('refund.reasonPlaceholder') || 'Please explain your reason...'}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            )}

            {/* Policy Note */}
            <View style={styles.policyCard}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.policyText}>
                {t('refund.policyNote') || 'Refund requests are reviewed by the event organizer. You will receive an email notification once your request has been processed.'}
                {' '}
                {t('refund.feeNonRefundable')}
              </Text>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmitRefund}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="send" size={20} color={colors.white} />
                  <Text style={styles.submitButtonText}>{t('refund.submit') || 'Submit Request'}</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  // In-flow header row — only the loading skeleton still uses this shape.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // Overlay chrome (OverlayHeader owns the row layout, the safe-area top
  // padding, the blur backdrop and the absolute placement) — only the row's own
  // geometry is ours. No paddingTop here: the SafeAreaView above runs
  // edges={['bottom']} precisely so OverlayHeader can pay the notch itself. No
  // fill and no hairline either: they would paint over the blur.
  headerBar: {
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0,
    color: colors.text,
  },
  ticketCard: {
    margin: 16,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ticketInfo: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 16,
    backgroundColor: colors.error + '10',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error + '30',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: colors.error,
    marginLeft: 12,
    lineHeight: 20,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  reasonOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '08',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  reasonText: {
    fontSize: 15,
    color: colors.text,
  },
  reasonTextSelected: {
    fontWeight: '600',
    color: colors.primary,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    fontSize: 15,
    color: colors.text,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  policyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    margin: 16,
    padding: 16,
    backgroundColor: colors.primary + '10',
    borderRadius: radius.md,
  },
  policyText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 12,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    marginTop: 8,
    padding: 16,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginLeft: 8,
  },
});
