import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronLeft, Calendar, MapPin, User as UserIcon, Ticket as TicketIcon, Send, Star, RotateCcw, CalendarPlus, Navigation } from 'lucide-react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { safeFormatForLanguage } from '../lib/dates';
import TransferTicketModal from '../components/TransferTicketModal';
import AddToWalletButton from '../components/AddToWalletButton';
import TicketQRCard from '../components/TicketQRCard';
import StatusChip from '../components/StatusChip';
import { useI18n } from '../contexts/I18nContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { font, radius } from '../theme/tokens';
import { formatCurrency } from '../lib/currency';
import { ticketOrderRef, ticketTierLabel, ticketQrValue, ticketStatusKey } from '../lib/ticket';
import { addToCalendar, openDirections } from '../lib/postPurchaseActions';
import { TicketDetailSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import { useMaxBrightnessWhileFocused } from '../lib/useMaxBrightness';
import { goBackOrHome } from '../lib/goBackOrHome';
import { isActiveTicketStatus } from '../lib/orderDisplay';

export default function TicketDetailScreen({ route }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { ticketId } = route.params;
  const { t, language } = useI18n();
  const navigation = useNavigation<any>();
  const showAlert = useAppAlert();
  // Max out brightness so the QR scans at a dim venue door; restore on leave.
  useMaxBrightnessWhileFocused();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<any>(null);
  // Tier validity window, resolved from the event's tier list by matching the
  // ticket's tier NAME. Null until (and unless) a window is found.
  const [tierValidity, setTierValidity] = useState<{ from?: Date; until?: Date } | null>(null);

  // Reload on every focus, not just mount: returning from RefundRequest (or a
  // transfer) must pick up the new refund_status so the button disappears.
  useFocusEffect(
    useCallback(() => {
      fetchTicketDetails();
      fetchPendingTransfer();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticketId])
  );

  const cacheKey = `ticket_cache_${ticketId}`;

  const fetchTicketDetails = async () => {
    try {
      const ticketDoc = await getDoc(doc(db, 'tickets', ticketId));
      if (ticketDoc.exists()) {
        const data = ticketDoc.data();
        const built = {
          id: ticketDoc.id,
          ...data,
          event_date: data.event_date?.toDate ? data.event_date.toDate() : data.event_date ? new Date(data.event_date) : null,
          purchase_date: data.purchase_date?.toDate ? data.purchase_date.toDate() : data.purchase_date ? new Date(data.purchase_date) : null
        };
        setTicket(built);
        resolveTierValidity(data);
        // Cache a JSON-safe copy so the attendee can still show their QR at the
        // door with no signal (the QR is generated locally from this data).
        try {
          await AsyncStorage.setItem(cacheKey, JSON.stringify({
            ...built,
            event_date: built.event_date ? built.event_date.toISOString() : null,
            purchase_date: built.purchase_date ? built.purchase_date.toISOString() : null,
          }));
        } catch {}
      }
    } catch (error) {
      console.error('Error fetching ticket:', error);
      // Offline and not in Firestore's session cache — fall back to the last
      // cached copy so the QR still renders. Only error out if we have nothing.
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const c = JSON.parse(raw);
          setTicket({
            ...c,
            event_date: c.event_date ? new Date(c.event_date) : null,
            purchase_date: c.purchase_date ? new Date(c.purchase_date) : null,
          });
        } else {
          showAlert(t('common.error'), t('ticketDetail.loadError'));
        }
      } catch {
        showAlert(t('common.error'), t('ticketDetail.loadError'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Resolve the ticket's tier by NAME within the event's embedded tier list and
  // surface its valid_from / valid_until window (subtle display only). Fails
  // silently — no window, no matched tier, or no event just means no line shown.
  const resolveTierValidity = async (ticketData: any) => {
    try {
      const eventId = ticketData.event_id;
      const tierName =
        ticketData.tier_name ||
        ticketData.ticket_tier_name ||
        ticketData.ticket_type ||
        ticketData.ticketType ||
        ticketData.tierName ||
        '';
      if (!eventId || !tierName) return;

      const eventDoc = await getDoc(doc(db, 'events', eventId));
      if (!eventDoc.exists()) return;

      const tiers = eventDoc.data()?.ticket_tiers;
      if (!Array.isArray(tiers)) return;
      const norm = (s: any) => String(s ?? '').trim().toLowerCase();
      const target = norm(tierName);
      const tier = tiers.find((x: any) => norm(x?.name) === target);
      if (!tier) return;

      const from = tier.valid_from ? new Date(tier.valid_from) : null;
      const until = tier.valid_until ? new Date(tier.valid_until) : null;
      const win: { from?: Date; until?: Date } = {};
      if (from && !isNaN(from.getTime())) win.from = from;
      if (until && !isNaN(until.getTime())) win.until = until;
      if (win.from || win.until) setTierValidity(win);
    } catch (error) {
      console.error('Error resolving tier validity:', error);
    }
  };

  const fetchPendingTransfer = async () => {
    try {
      const { getDocs, collection, query, where } = await import('firebase/firestore');
      const transfersQuery = query(
        collection(db, 'ticket_transfers'),
        where('ticket_id', '==', ticketId),
        where('status', '==', 'pending'),
        // The read rule only lets the sender list their own transfers.
        where('from_user_id', '==', auth.currentUser?.uid ?? '')
      );
      const transfersSnapshot = await getDocs(transfersQuery);
      
      if (!transfersSnapshot.empty) {
        const transferDoc = transfersSnapshot.docs[0];
        const data = transferDoc.data();
        setPendingTransfer({
          id: transferDoc.id,
          ...data,
          expires_at: data.expires_at?.toDate ? data.expires_at.toDate() : data.expires_at ? new Date(data.expires_at) : null,
        });
      }
    } catch (error) {
      console.error('Error fetching pending transfer:', error);
    }
  };

  const handleCancelTransfer = async () => {
    if (!pendingTransfer) return;

    showAlert(
      t('ticketDetail.transfer.cancelTitle'),
      t('ticketDetail.transfer.cancelBody'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('ticketDetail.transfer.yesCancel'),
          style: 'destructive',
          onPress: async () => {
            try {
              const { updateDoc, doc } = await import('firebase/firestore');
              await updateDoc(doc(db, 'ticket_transfers', pendingTransfer.id), {
                status: 'cancelled',
                updated_at: new Date().toISOString()
              });
              setPendingTransfer(null);
              showAlert(t('common.success'), t('ticketDetail.transfer.cancelSuccess'));
            } catch (error) {
              console.error('Error cancelling transfer:', error);
              showAlert(t('common.error'), t('ticketDetail.transfer.cancelError'));
            }
          }
        }
      ]
    );
  };



  if (loading) {
    return (
      <View style={styles.container}>
        <TicketDetailSkeleton />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{t('ticketDetail.notFound')}</Text>
      </View>
    );
  }

  // Check if event has ended (ticket expired)
  const now = new Date();
  const eventEnd = new Date(ticket.end_datetime || ticket.event_date || ticket.start_datetime);
  const isExpired = now > eventEnd;
  const isActive = isActiveTicketStatus(ticket.status);

  const statusLabel = (() => {
    if (isExpired) return t('ticketDetail.status.expired');
    const raw = String(ticket.status || '').toLowerCase();
    // 'valid' is what the server writes for MonCash / SogePay / free / comp.
    if (raw === 'confirmed' || raw === 'valid') return t('ticketDetail.status.confirmed');
    if (raw === 'used' || raw === 'checked_in') return t('ticketDetail.status.used');
    if (raw === 'active') return t('ticketDetail.status.active');
    if (raw === 'refunded') return t('ticketDetail.status.refunded');
    if (raw === 'cancelled') return t('ticketDetail.status.cancelled');
    return String(ticket.status || '').toUpperCase();
  })();

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          {/* Header with Title */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => goBackOrHome(navigation)}
              hitSlop={12}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <ChevronLeft size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.eventTitle} numberOfLines={2}>{ticket.event_title}</Text>
          </View>

          {/* Status Chip — driven by ticket STATE (locked color map). */}
          <View style={styles.statusChipRow}>
            <StatusChip status={ticketStatusKey(ticket, isExpired)} label={statusLabel} />
          </View>

          {/* Inverted WHITE ticket + BLACK-on-white QR (the one shared identity) */}
          {/* QR stays FULL opacity even when expired — a late/edge scan must still
              work; "expired" is conveyed by the status chip + expiredBody copy. */}
          <View style={styles.qrSection}>
            <TicketQRCard
              qrValue={ticketQrValue(ticket, ticketId)}
              eventTitle={ticket.event_title}
              dateLabel={ticket.event_date ? safeFormatForLanguage(ticket.event_date, 'EEE, MMM d · h:mm a', language) : undefined}
              tierName={ticketTierLabel(ticket)}
              holderName={ticket.user_name ? `${t('ticketDetail.admit')} ${ticket.user_name}` : undefined}
              orderRef={ticketOrderRef(ticket).replace(/^TKM-/, '')}
            />
            <Text style={styles.qrInstruction}>
              {isExpired
                ? t('ticketDetail.qr.expiredBody')
                : t('ticketDetail.qr.instruction')
              }
            </Text>
          </View>

          {/* Transfer Button */}
          {isActive && (
            <>
              {/* Pending Transfer Status */}
              {pendingTransfer && (
                <View style={styles.pendingTransferCard}>
                  <View style={styles.pendingTransferHeader}>
                    <View style={styles.pendingTransferBadge}>
                      <Text style={styles.pendingTransferBadgeText}>⏳ {t('ticketDetail.transfer.pending')}</Text>
                    </View>
                  </View>
                  <Text style={styles.pendingTransferEmail}>
                    {t('ticketDetail.transfer.sentTo')} <Text style={styles.pendingTransferEmailBold}>{pendingTransfer.to_email}</Text>
                  </Text>
                  {pendingTransfer.expires_at && (
                    <Text style={styles.pendingTransferExpiry}>
                      {t('ticketDetail.transfer.expires')} {safeFormatForLanguage(pendingTransfer.expires_at, 'MMM dd, yyyy h:mm a', language)}
                    </Text>
                  )}
                  <Text style={styles.pendingTransferExpiry}>{t('ticketDetail.transfer.newCodeNote')}</Text>
                  <TouchableOpacity
                    style={styles.cancelTransferButton}
                    onPress={handleCancelTransfer}
                  >
                    <Text style={styles.cancelTransferButtonText}>{t('ticketDetail.transfer.cancelButton')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Transfer Button - Only show if no pending transfer */}
              {!pendingTransfer && (
                <TouchableOpacity
                  style={styles.transferButton}
                  onPress={() => setShowTransferModal(true)}
                >
                  <View style={styles.transferButtonContent}>
                    <View style={styles.transferButtonIcon}>
                      <Send size={22} color={colors.white} />
                    </View>
                    <View style={styles.transferButtonTextContainer}>
                      <Text style={styles.transferButtonTitle}>{t('ticketDetail.transfer.buttonTitle')}</Text>
                      <Text style={styles.transferButtonSubtitle}>{t('ticketDetail.transfer.buttonSubtitle')}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Key Info Cards */}
          <View style={styles.infoCards}>
            <View style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                <Calendar size={20} color={colors.primary} />
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardLabel}>{t('ticketDetail.labels.dateTime')}</Text>
                <Text style={styles.infoCardValue}>
                  {ticket.event_date && safeFormatForLanguage(ticket.event_date, 'MMM dd, yyyy', language)}
                </Text>
                <Text style={styles.infoCardSubvalue}>
                  {ticket.event_date && safeFormatForLanguage(ticket.event_date, 'h:mm a', language)}
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                <MapPin size={20} color={colors.primary} />
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardLabel}>{t('ticketDetail.labels.venue')}</Text>
                <Text style={styles.infoCardValue}>{ticket.venue_name}</Text>
                <Text style={styles.infoCardSubvalue}>{ticket.city}</Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                <UserIcon size={20} color={colors.primary} />
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardLabel}>{t('ticketDetail.labels.attendee')}</Text>
                <Text style={styles.infoCardValue}>{ticket.user_name}</Text>
                <Text style={styles.infoCardSubvalue}>{ticket.user_email}</Text>
              </View>
            </View>
          </View>

          {/* Ticket Details Card */}
          <View style={styles.detailsCard}>
            <View style={styles.detailsHeader}>
              <TicketIcon size={20} color={colors.primary} />
              <Text style={styles.detailsTitle}>{t('ticketDetail.details.title')}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.type')}</Text>
              <Text style={styles.detailValue}>{ticket.ticket_type}</Text>
            </View>
            {tierValidity?.from && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('organizerCreateEventFlow.canvas.ticketValidFromLabel')}</Text>
                <Text style={styles.detailValue}>{safeFormatForLanguage(tierValidity.from, 'MMM dd, yyyy h:mm a', language)}</Text>
              </View>
            )}
            {tierValidity?.until && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{t('organizerCreateEventFlow.canvas.ticketValidUntilLabel')}</Text>
                <Text style={styles.detailValue}>{safeFormatForLanguage(tierValidity.until, 'MMM dd, yyyy h:mm a', language)}</Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.quantity')}</Text>
              <Text style={styles.detailValue}>{ticket.quantity}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.price')}</Text>
              <Text style={styles.detailValue}>
                {formatCurrency(Number(ticket.price_paid ?? ticket.price ?? 0), ticket.currency)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.orderRef') || 'Order'}</Text>
              <Text style={[styles.detailValue, styles.ticketId]} numberOfLines={1}>
                {ticketOrderRef(ticket)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.purchaseDate')}</Text>
              <Text style={styles.detailValue}>
                {ticket.purchase_date && safeFormatForLanguage(ticket.purchase_date, 'MMM dd, yyyy', language)}
              </Text>
            </View>
          </View>

          {/* Add to Wallet + post-purchase action stack */}
          {isActive && (
            <View style={styles.walletSection}>
              <AddToWalletButton
                ticketId={ticket.id}
                qrCodeData={ticketQrValue(ticket, ticketId)}
                eventTitle={ticket.event_title}
                eventDate={ticket.event_date ? safeFormatForLanguage(ticket.event_date, 'MMMM dd, yyyy h:mm a', language) : ''}
                venueName={ticket.venue_name}
                ticketNumber={1}
                totalTickets={ticket.quantity || 1}
              />

              <View style={styles.postPurchaseRow}>
                <TouchableOpacity
                  style={styles.postPurchaseButton}
                  onPress={() =>
                    addToCalendar({
                      title: ticket.event_title || 'Event',
                      start: ticket.event_date || null,
                      end: ticket.end_datetime ? new Date(ticket.end_datetime) : null,
                      location: [ticket.venue_name, ticket.city].filter(Boolean).join(', '),
                      details: `Tikèm ticket · ${ticketOrderRef(ticket)}`,
                    })
                  }
                  activeOpacity={0.8}
                >
                  <CalendarPlus size={18} color={colors.text} />
                  <Text style={styles.postPurchaseText}>{t('ticketDetail.actions.addToCalendar') || 'Add to calendar'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.postPurchaseButton}
                  onPress={() =>
                    openDirections({
                      venue: ticket.venue_name,
                      address: ticket.address,
                      city: ticket.city,
                      lat: ticket.latitude ?? null,
                      lng: ticket.longitude ?? null,
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Navigation size={18} color={colors.text} />
                  <Text style={styles.postPurchaseText}>{t('ticketDetail.actions.getDirections') || 'Get directions'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtonsSection}>
            {/* Request Refund Button - Only show for upcoming events */}
            {!isExpired && isActive &&
             (!ticket.refund_status || ticket.refund_status === 'none') && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('RefundRequest', { ticketId: ticket.id })}
              >
                <View style={[styles.actionButtonIcon, { backgroundColor: colors.error + '15' }]}>
                  <RotateCcw size={20} color={colors.error} />
                </View>
                <View style={styles.actionButtonText}>
                  <Text style={styles.actionButtonTitle}>{t('ticketDetail.actions.requestRefund') || 'Request Refund'}</Text>
                  <Text style={styles.actionButtonSubtitle}>{t('ticketDetail.actions.refundSubtitle') || 'Get your money back'}</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Refund Status Badge */}
            {ticket.refund_status && ticket.refund_status !== 'none' && (
              <View style={[styles.refundStatusBadge, 
                ticket.refund_status !== 'approved' && ticket.refund_status !== 'denied' && styles.refundStatusPending,
                ticket.refund_status === 'approved' && styles.refundStatusApproved,
                ticket.refund_status === 'denied' && styles.refundStatusDenied,
              ]}>
                <RotateCcw size={16} color={
                  ticket.refund_status === 'approved' ? colors.success :
                  ticket.refund_status === 'denied' ? colors.error : colors.warning
                } />
                <Text style={[styles.refundStatusText,
                  ticket.refund_status === 'approved' && { color: colors.success },
                  ticket.refund_status === 'denied' && { color: colors.error },
                ]}>
                  {ticket.refund_status === 'admin_review' ? t('ticketDetail.refund.underReview') :
                   ticket.refund_status === 'approved' ? (t('ticketDetail.refund.approved') || 'Refund Approved') :
                   ticket.refund_status === 'denied' ? (t('ticketDetail.refund.denied') || 'Refund Denied') :
                   (t('ticketDetail.refund.pending') || 'Refund Pending')}
                </Text>
              </View>
            )}

            {/* Leave Review Button - Only show for past events */}
            {isExpired && (isActive || ticket.status === 'used' || ticket.status === 'checked_in') && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Review', { 
                  ticketId: ticket.id, 
                  eventId: ticket.event_id,
                  eventTitle: ticket.event_title 
                })}
              >
                <View style={[styles.actionButtonIcon, { backgroundColor: '#FFB800' + '20' }]}>
                  <Star size={20} color="#FFB800" />
                </View>
                <View style={styles.actionButtonText}>
                  <Text style={styles.actionButtonTitle}>{t('ticketDetail.actions.leaveReview') || 'Leave a Review'}</Text>
                  <Text style={styles.actionButtonSubtitle}>{t('ticketDetail.actions.reviewSubtitle') || 'Share your experience'}</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer Note */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('ticketDetail.footer.keepSafe')}</Text>
            <Text style={styles.footerSubtext}>
              {t('ticketDetail.footer.qrEntryPass')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Transfer Modal */}
      <TransferTicketModal
        visible={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        ticketId={ticketId}
        eventTitle={ticket.event_title}
        transferCount={ticket.transfer_count || 0}
        onTransferSuccess={() => {
          fetchPendingTransfer();
          setShowTransferModal(false);
        }}
      />
    </View>
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
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
  },
  backBtn: {
    marginLeft: -6,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  eventTitle: {
    fontFamily: font.serif,
    fontSize: 28,
    color: colors.text,
    lineHeight: 30,
  },
  statusChipRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  qrSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  postPurchaseRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  postPurchaseButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
  },
  postPurchaseText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  qrInstruction: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  infoCards: {
    gap: 16,
    marginBottom: 24,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  infoCardValue: {
    fontSize: 14,
    letterSpacing: 0.3,
    color: colors.text,
    marginBottom: 2,
  },
  infoCardSubvalue: {
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textSecondary,
  },
  detailsCard: {
    backgroundColor: colors.surface,
    padding: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  detailsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  detailLabel: {
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.text,
    textAlign: 'right',
    maxWidth: '60%',
  },
  ticketId: {
    fontFamily: font.monoRegular,
    fontSize: 12,
  },
  footer: {
    backgroundColor: colors.primary + '10',
    padding: 20,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    marginBottom: 40,
  },
  footerText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  walletSection: {
    marginBottom: 24,
  },
  pendingTransferCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.md,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  pendingTransferHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  pendingTransferBadge: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.lg,
  },
  pendingTransferBadgeText: {
    color: colors.white,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pendingTransferEmail: {
    fontSize: 14,
    color: colors.text,
    marginBottom: 6,
  },
  pendingTransferEmailBold: {
    fontWeight: '700',
  },
  pendingTransferExpiry: {
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  cancelTransferButton: {
    backgroundColor: colors.surfaceRaised,
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#F59E0B',
    alignItems: 'center',
  },
  cancelTransferButtonText: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '700',
  },
  transferButton: {
    backgroundColor: colors.primary,
    padding: 18,
    borderRadius: radius.lg,
    marginBottom: 32,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 0,
  },
  transferButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transferButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  transferButtonTextContainer: {
    flex: 1,
  },
  transferButtonTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 3,
  },
  transferButtonSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  actionButtonsSection: {
    marginBottom: 24,
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionButtonText: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  actionButtonSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  refundStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  refundStatusPending: {
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning + '40',
  },
  refundStatusApproved: {
    backgroundColor: colors.successLight,
    borderWidth: 1,
    borderColor: colors.success + '40',
  },
  refundStatusDenied: {
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error + '40',
  },
  refundStatusText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.warning,
  },
});
