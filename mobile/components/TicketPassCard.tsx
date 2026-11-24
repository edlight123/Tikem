import React from 'react';
import { joinA11y } from '../lib/a11y';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Touchable } from './ui/Touchable';
import { CalendarPlus, MapPin, Send, ExternalLink } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import type { Language } from '../contexts/I18nContext';
import { safeFormatForLanguage } from '../lib/dates';
import TicketQRCard from './TicketQRCard';
import StatusChip from './StatusChip';
import AddToWalletButton from './AddToWalletButton';
import { ticketOrderRef, ticketTierLabel, ticketQrValue, ticketStatusKey } from '../lib/ticket';
import { addToCalendar, openDirections } from '../lib/postPurchaseActions';
import { colors as T, radius } from '../theme/tokens';
import { isLiveTicket } from '../lib/orderDisplay';

interface TicketPassCardProps {
  ticket: any;
  event: any;
  user: any;
  /** Shown as "Ticket 2" only when there are several. */
  ticketNumber?: number;
  onQRPress: () => void;
  onViewEvent: () => void;
  onTransferPress?: () => void;
}

/** Guarded, locale-aware date → formatted label; returns undefined for missing/invalid dates. */
function safeDate(value: any, pattern: string, language: Language): string | undefined {
  return safeFormatForLanguage(value, pattern, language) || undefined;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Post-purchase ticket pass. Renders the ONE shared ticket identity — the
 * inverted white `TicketQRCard` (BLACK-on-white QR) — then a POSH §2.4 action
 * stack: Add to Wallet (white primary) · Add to calendar · Get directions ·
 * Transfer · View event. Fed real fields (real tier, TKM- order ref, holder).
 */
export default function TicketPassCard({
  ticket,
  event,
  user,
  ticketNumber,
  onQRPress,
  onViewEvent,
  onTransferPress,
}: TicketPassCardProps) {
  const { colors } = useTheme();
  const { language, t } = useI18n();
  const styles = getStyles(colors);

  const start = toDate(event?.start_datetime) || toDate(ticket?.event_date);
  const end = toDate(event?.end_datetime);
  const isExpired = end ? new Date() > end : false;
  const isUsed = !!ticket?.checked_in_at || String(ticket?.status || '').toLowerCase() === 'used';
  // Refunded / cancelled / transferred-away tickets keep the QR for reference
  // but must not offer Wallet or Transfer.
  const isLive = isLiveTicket(ticket?.status);

  const eventTitle = event?.title || ticket?.event_title || t('common.event');
  const dateLabel = safeDate(start, 'EEE, MMM d · h:mm a', language);
  const tier = ticketTierLabel(ticket);
  const holder = user?.displayName || user?.email || undefined;
  const orderRef = ticketOrderRef(ticket);
  const statusKey = ticketStatusKey(ticket, isExpired);

  const venueLabel = [event?.venue_name, event?.address, event?.city]
    .filter(Boolean)
    .join(', ');

  const handleCalendar = () =>
    addToCalendar({
      title: eventTitle,
      start,
      end,
      location: venueLabel || event?.venue_name || undefined,
      details: `Tikèm ticket · ${orderRef}`,
    });

  const handleDirections = () =>
    openDirections({
      venue: event?.venue_name,
      address: event?.address,
      city: event?.city,
      lat: event?.latitude ?? event?.lat ?? null,
      lng: event?.longitude ?? event?.lng ?? null,
    });

  return (
    <View style={styles.wrapper}>
      <View style={styles.chipRow}>
        <StatusChip status={statusKey} label={isUsed || !ticketNumber ? undefined : t('ticketPass.ticketNumber').replace('{count}', String(ticketNumber))} />
      </View>

      {/* The one shared ticket identity — white inverted stub. Tap to enlarge. */}
      <Touchable
        scale={0.98}
        onPress={onQRPress}
        accessibilityRole="button"
        accessibilityLabel={joinA11y(t('a11y.qrCode'), eventTitle, dateLabel, tier, holder, orderRef)}
        accessibilityHint={t('a11y.qrCodeHint')}
      >
        <TicketQRCard
          qrValue={ticketQrValue(ticket)}
          eventTitle={eventTitle}
          dateLabel={dateLabel}
          tierName={tier}
          holderName={holder ? `${t('ticketPass.admit')} ${holder}` : undefined}
          orderRef={orderRef.replace(/^TKM-/, '')}
        />
      </Touchable>

      {isUsed && ticket?.checked_in_at && (
        <View style={styles.usedBanner}>
          <Text style={styles.usedBannerText}>
            ✓ {t('ticketPass.checkedIn')} {safeDate(ticket.checked_in_at, 'MMM d, yyyy · h:mm a', language) || ''}
          </Text>
        </View>
      )}

      {/* Post-purchase action stack */}
      <View style={styles.actions}>
        {isLive && (
          <AddToWalletButton
            ticketId={ticket?.id}
            qrCodeData={ticketQrValue(ticket)}
            eventTitle={eventTitle}
            eventDate={dateLabel || ''}
            venueName={event?.venue_name || ''}
            ticketNumber={ticketNumber ?? 1}
            totalTickets={ticket?.quantity || 1}
          />
        )}

        {/* One quiet row of square white actions, short labels underneath
            (ported from Tikra, TestFlight 2026-11-24: "more premium"). */}
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quick} onPress={handleCalendar} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('ticketPass.addToCalendar')}>
            <View style={styles.quickIcon}><CalendarPlus size={20} color={T.onWhite} strokeWidth={1.8} /></View>
            <Text style={styles.quickText} numberOfLines={1}>{t('ticketPass.calendarShort')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quick} onPress={handleDirections} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('ticketPass.getDirections')}>
            <View style={styles.quickIcon}><MapPin size={20} color={T.onWhite} strokeWidth={1.8} /></View>
            <Text style={styles.quickText} numberOfLines={1}>{t('ticketPass.directionsShort')}</Text>
          </TouchableOpacity>
          {onTransferPress && !isUsed && isLive && (
            <TouchableOpacity style={styles.quick} onPress={onTransferPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('ticketPass.transfer')}>
              <View style={styles.quickIcon}><Send size={20} color={T.onWhite} strokeWidth={1.8} /></View>
              <Text style={styles.quickText} numberOfLines={1}>{t('ticketPass.transfer')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.quick} onPress={onViewEvent} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('ticketPass.viewEvent')}>
            <View style={styles.quickIcon}><ExternalLink size={20} color={T.onWhite} strokeWidth={1.8} /></View>
            <Text style={styles.quickText} numberOfLines={1}>{t('ticketPass.eventShort')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    wrapper: {
      width: '100%',
    },
    chipRow: {
      alignItems: 'center',
      marginBottom: 12,
    },
    usedBanner: {
      backgroundColor: colors.successLight,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      marginTop: 12,
    },
    usedBannerText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.success,
      textAlign: 'center',
    },
    actions: {
      marginTop: 20,
      gap: 12,
    },
    quickRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
    quick: { alignItems: 'center', gap: 6, minWidth: 64 },
    // Square white tiles (the 4px rule), black line icons.
    quickIcon: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
    quickText: { fontSize: 12, fontWeight: '600', color: colors.text },
  });
