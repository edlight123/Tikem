import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, Calendar, MapPin, User as UserIcon, Send, Star, RotateCcw, CalendarPlus, Navigation } from 'lucide-react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { backendJson } from '../lib/api/backend';
import { useTheme } from '../contexts/ThemeContext';
import { formatEventTime, safeFormatForLanguage } from '../lib/dates';
import { ticketLanguage } from '../lib/eventClock';
import TransferTicketModal from '../components/TransferTicketModal';
import AddToWalletButton from '../components/AddToWalletButton';
import TicketQRCard from '../components/TicketQRCard';
import StatusChip from '../components/StatusChip';
import { useI18n, translateIn } from '../contexts/I18nContext';
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
import SectionHeader from '../components/SectionHeader';
import { Touchable } from '../components/ui/Touchable';
import { doorBalance, doorMoney } from '../lib/payAtDoor';
import { Text as UIText } from '../components/ui/Text';
import { addOnLabel, ticketAddOns } from '../lib/addOns';

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
  // The event's country + zone: a Haiti ticket is French with "8:00 PM" times.
  const [eventPlace, setEventPlace] = useState<{ country?: string; timezone?: string } | null>(null);

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
      if (!eventId) return;

      const eventDoc = await getDoc(doc(db, 'events', eventId));
      if (!eventDoc.exists()) return;
      const ev = eventDoc.data() as any;
      setEventPlace({
        country: typeof ev?.country === 'string' ? ev.country : undefined,
        timezone: typeof ev?.timezone === 'string' ? ev.timezone : undefined,
      });
      if (!tierName) return;

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
      
      // A 'pending' row past its 24h expiry is not pending (the server treats it
      // as expired and allows a new transfer), so don't let it hide the button.
      const live = transfersSnapshot.docs
        .map((transferDoc) => {
          const data = transferDoc.data();
          const expires = data.expires_at?.toDate ? data.expires_at.toDate() : data.expires_at ? new Date(data.expires_at) : null;
          return { id: transferDoc.id, ...data, expires_at: expires };
        })
        .find((tr: any) => !(tr.expires_at instanceof Date && !isNaN(tr.expires_at.getTime()) && tr.expires_at.getTime() <= Date.now()));
      setPendingTransfer(live ?? null);
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
              // Through the server, like the web: it also stamps responded_at
              // and tells the recipient (email + push) the offer is gone. A
              // direct status write left them holding a dead "you've been
              // sent a ticket" notice.
              await backendJson('/api/tickets/transfer/cancel', {
                method: 'POST',
                body: JSON.stringify({ transferId: pendingTransfer.id }),
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
        <TicketDetailSkeleton
          backButton={
            <Touchable
              onPress={() => goBackOrHome(navigation)}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <ChevronLeft size={24} color={colors.text} />
            </Touchable>
          }
        />
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

  const ticketPlace = {
    country: ticket.country || eventPlace?.country,
    timezone: eventPlace?.timezone || ticket.timezone,
  };
  const ticketLang = ticketLanguage(ticketPlace, language);

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
            <Touchable
              onPress={() => goBackOrHome(navigation)}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <ChevronLeft size={24} color={colors.text} />
            </Touchable>
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
              dateLabel={ticket.event_date ? formatEventTime(ticket.event_date, ticketPlace, 'EEE, MMM d · h:mm a', ticketLang) : undefined}
              tierName={ticketTierLabel(ticket)}
              holderName={ticket.user_name ? `${translateIn(ticketLang, 'ticketDetail.admit')} ${ticket.user_name}` : undefined}
              orderRef={ticketOrderRef(ticket).replace(/^TKM-/, '')}
              orderLabel={translateIn(ticketLang, 'ticketPass.orderRef', { ref: ticketOrderRef(ticket).replace(/^TKM-/, '') })}
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
                    <StatusChip status="pending" label={t('ticketDetail.transfer.pending')} />
                  </View>
                  <Text style={styles.pendingTransferEmail}>
                    {t('ticketDetail.transfer.sentTo')} <Text style={styles.pendingTransferEmailBold}>{pendingTransfer.to_email || pendingTransfer.to_name}</Text>
                  </Text>
                  {pendingTransfer.expires_at && (
                    <Text style={styles.pendingTransferExpiry}>
                      {t('ticketDetail.transfer.expires')} {safeFormatForLanguage(pendingTransfer.expires_at, 'MMM dd, yyyy h:mm a', language)}
                    </Text>
                  )}
                  <Text style={styles.pendingTransferExpiry}>{t('ticketDetail.transfer.newCodeNote')}</Text>
                  <Touchable
                    style={styles.cancelTransferButton}
                    onPress={handleCancelTransfer}
                    accessibilityRole="button"
                  >
                    <Text style={styles.cancelTransferButtonText}>{t('ticketDetail.transfer.cancelButton')}</Text>
                  </Touchable>
                </View>
              )}

              {/* Transfer Button - Only show if no pending transfer */}
              {!pendingTransfer && (
                <Touchable
                  style={styles.transferButton}
                  scale={0.98}
                  onPress={() => setShowTransferModal(true)}
                  accessibilityRole="button"
                >
                  <View style={styles.transferButtonContent}>
                    <View style={styles.transferButtonIcon}>
                      <Send size={20} color={colors.text} strokeWidth={1.75} />
                    </View>
                    <View style={styles.transferButtonTextContainer}>
                      <Text style={styles.transferButtonTitle}>{t('ticketDetail.transfer.buttonTitle')}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textTertiary} />
                  </View>
                </Touchable>
              )}
            </>
          )}

          {/* Key Info Cards */}
          <View style={styles.infoCards}>
            <View style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                <Calendar size={18} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={styles.infoCardContent}>
                <UIText variant="eyebrow" style={styles.infoCardLabel}>{t('ticketDetail.labels.dateTime')}</UIText>
                <Text style={styles.infoCardValue}>
                  {ticket.event_date && formatEventTime(ticket.event_date, ticketPlace, 'MMM dd, yyyy', language)}
                </Text>
                <Text style={styles.infoCardSubvalue}>
                  {ticket.event_date && formatEventTime(ticket.event_date, ticketPlace, 'h:mm a', language)}
                </Text>
              </View>
            </View>

            <View style={[styles.infoCard, styles.infoCardDivided]}>
              <View style={styles.infoCardIcon}>
                <MapPin size={18} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={styles.infoCardContent}>
                <UIText variant="eyebrow" style={styles.infoCardLabel}>{t('ticketDetail.labels.venue')}</UIText>
                <Text style={styles.infoCardValue}>{ticket.venue_name}</Text>
                <Text style={styles.infoCardSubvalue}>{ticket.city}</Text>
              </View>
            </View>

            <View style={[styles.infoCard, styles.infoCardDivided]}>
              <View style={styles.infoCardIcon}>
                <UserIcon size={18} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={styles.infoCardContent}>
                <UIText variant="eyebrow" style={styles.infoCardLabel}>{t('ticketDetail.labels.attendee')}</UIText>
                <Text style={styles.infoCardValue}>{ticket.user_name}</Text>
                <Text style={styles.infoCardSubvalue}>{ticket.user_email}</Text>
              </View>
            </View>
          </View>

          {/* Ticket Details */}
          <SectionHeader title={t('ticketDetail.details.title')} />
          <View style={styles.detailsCard}>
            <View style={[styles.detailRow, styles.detailRowFirst]}>
              <Text style={styles.detailLabel}>{t('ticketDetail.details.type')}</Text>
              <Text style={styles.detailValue}>{ticket.ticket_type}</Text>
            </View>
            {(() => {
              // Pay at the door: what to bring, or that it is settled.
              const door = doorBalance(ticket);
              if (!door) return null;
              return (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('ticketDetail.details.payAtDoor')}</Text>
                  <Text style={styles.detailValue}>
                    {door.paid
                      ? t('ticketDetail.details.paidAtDoor')
                      : doorMoney(door.owes, door.currency, language)}
                  </Text>
                </View>
              );
            })()}
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

          {/* Add-ons bought with the order (lib/addOns): on its first ticket. */}
          {ticketAddOns(ticket).length > 0 ? (
            <>
              <SectionHeader title={t('addOns.yourAddOns')} />
              <View style={styles.detailsCard}>
                {ticketAddOns(ticket).map((a, i) => (
                  <View key={`${a.id}|${a.option || ''}|${i}`} style={[styles.detailRow, i === 0 && styles.detailRowFirst]}>
                    <Text style={[styles.detailLabel, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                      {addOnLabel(a)}
                    </Text>
                    <Text style={[styles.detailValue, { color: a.picked_up_at ? colors.success : colors.textSecondary }]}>
                      {a.picked_up_at ? t('addOns.pickedUp') : t('addOns.toCollect')}
                    </Text>
                  </View>
                ))}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('addOns.collectHint')}</Text>
                </View>
              </View>
            </>
          ) : ticket.add_ons_ticket_id ? (
            <Text style={[styles.detailLabel, { marginTop: -20, marginBottom: 24 }]}>{t('addOns.onFirstTicket')}</Text>
          ) : null}

          {/* Add to Wallet + post-purchase action stack */}
          {isActive && (
            <View style={styles.walletSection}>
              <AddToWalletButton
                ticketId={ticket.id}
                qrCodeData={ticketQrValue(ticket, ticketId)}
                eventTitle={ticket.event_title}
                eventDate={ticket.event_date ? formatEventTime(ticket.event_date, ticketPlace, 'MMMM dd, yyyy h:mm a', ticketLang) : ''}
                venueName={ticket.venue_name}
                ticketNumber={1}
                totalTickets={ticket.quantity || 1}
              />

              <View style={styles.postPurchaseRow}>
                <Touchable
                  style={styles.postPurchaseButton}
                  accessibilityRole="button"
                  onPress={() =>
                    addToCalendar({
                      title: ticket.event_title || 'Event',
                      start: ticket.event_date || null,
                      end: ticket.end_datetime ? new Date(ticket.end_datetime) : null,
                      location: [ticket.venue_name, ticket.city].filter(Boolean).join(', '),
                      details: `Tikèm ticket · ${ticketOrderRef(ticket)}`,
                    })
                  }
                >
                  <CalendarPlus size={18} color={colors.text} strokeWidth={1.75} />
                  <Text style={styles.postPurchaseText}>{t('ticketDetail.actions.addToCalendar') || 'Add to calendar'}</Text>
                </Touchable>
                <Touchable
                  style={styles.postPurchaseButton}
                  accessibilityRole="button"
                  onPress={() =>
                    openDirections({
                      venue: ticket.venue_name,
                      address: ticket.address,
                      city: ticket.city,
                      lat: ticket.latitude ?? null,
                      lng: ticket.longitude ?? null,
                    })
                  }
                >
                  <Navigation size={18} color={colors.text} strokeWidth={1.75} />
                  <Text style={styles.postPurchaseText}>{t('ticketDetail.actions.getDirections') || 'Get directions'}</Text>
                </Touchable>
              </View>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtonsSection}>
            {/* Request Refund Button - Only show for upcoming events */}
            {!isExpired && isActive &&
             (!ticket.refund_status || ticket.refund_status === 'none') && (
              <Touchable
                style={styles.actionButton}
                scale={0.98}
                accessibilityRole="button"
                onPress={() => navigation.navigate('RefundRequest', { ticketId: ticket.id })}
              >
                <View style={styles.actionButtonIcon}>
                  <RotateCcw size={18} color={colors.textSecondary} strokeWidth={1.75} />
                </View>
                <View style={styles.actionButtonText}>
                  <Text style={styles.actionButtonTitle}>{t('ticketDetail.actions.requestRefund') || 'Request Refund'}</Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </Touchable>
            )}

            {/* Refund Status Badge */}
            {ticket.refund_status && ticket.refund_status !== 'none' && (
              // Dot + label on a quiet fill (no tinted status box).
              <View style={styles.refundStatusBadge}>
                <RotateCcw size={18} color={colors.textSecondary} strokeWidth={1.75} />
                <StatusChip
                  status={
                    ticket.refund_status === 'approved'
                      ? 'success'
                      : ticket.refund_status === 'denied'
                        ? 'declined'
                        : 'pending'
                  }
                  label={
                    ticket.refund_status === 'admin_review' ? t('ticketDetail.refund.underReview') :
                    ticket.refund_status === 'approved' ? (t('ticketDetail.refund.approved') || 'Refund Approved') :
                    ticket.refund_status === 'denied' ? (t('ticketDetail.refund.denied') || 'Refund Denied') :
                    (t('ticketDetail.refund.pending') || 'Refund Pending')
                  }
                />
              </View>
            )}

            {/* Leave Review Button - Only show for past events */}
            {isExpired && (isActive || ticket.status === 'used' || ticket.status === 'checked_in') && (
              <Touchable
                style={styles.actionButton}
                scale={0.98}
                accessibilityRole="button"
                onPress={() => navigation.navigate('Review', { 
                  ticketId: ticket.id, 
                  eventId: ticket.event_id,
                  eventTitle: ticket.event_title 
                })}
              >
                <View style={styles.actionButtonIcon}>
                  <Star size={18} color={colors.textSecondary} strokeWidth={1.75} />
                </View>
                <View style={styles.actionButtonText}>
                  <Text style={styles.actionButtonTitle}>{t('ticketDetail.actions.leaveReview') || 'Leave a Review'}</Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </Touchable>
            )}
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
    lineHeight: 34,
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  qrInstruction: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  // One filled surface; hairlines only BETWEEN the rows.
  infoCards: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  infoCardDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoCardIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardLabel: {
    marginBottom: 4,
  },
  infoCardValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  infoCardSubvalue: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailsCard: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    marginTop: 12,
    marginBottom: 32,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  detailRowFirst: {
    borderTopWidth: 0,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'right',
    maxWidth: '60%',
  },
  ticketId: {
    fontFamily: font.monoRegular,
    fontSize: 12,
  },
  walletSection: {
    marginBottom: 24,
  },
  pendingTransferCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.md,
    marginBottom: 24,
  },
  pendingTransferHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pendingTransferEmail: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 4,
  },
  pendingTransferEmailBold: {
    fontWeight: '700',
  },
  pendingTransferExpiry: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  cancelTransferButton: {
    backgroundColor: colors.surfaceRaised,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  cancelTransferButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  // A filled row like the other ticket actions: no teal slab, no glow.
  transferButton: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
    marginBottom: 32,
  },
  transferButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transferButtonIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transferButtonTextContainer: {
    flex: 1,
  },
  transferButtonTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  errorText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  actionButtonsSection: {
    marginBottom: 40,
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.lg,
  },
  actionButtonIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionButtonText: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  refundStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: 12,
  },
});
