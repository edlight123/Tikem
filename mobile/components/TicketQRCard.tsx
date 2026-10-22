import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { radius, spacing } from '../theme/tokens';

interface TicketQRCardProps {
  /** The value encoded into the QR (ticket id / signed token). */
  qrValue: string;
  eventTitle: string;
  /** Pre-formatted date string. Rendered only when a valid, non-empty string. */
  dateLabel?: string;
  tierName?: string;
  holderName?: string;
  /** Short order reference, e.g. "TKM-4821". */
  orderRef?: string;
  style?: ViewStyle;
}

/** Guard against empty / "Invalid Date" strings leaking into the stub. */
function cleanLabel(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /invalid date/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * The inverted WHITE ticket stub (POSH §2.4). Deliberately breaks the dark
 * theme: a white card with BLACK text reads as a physical object pulled out of
 * the black app, and a white background makes the QR scan reliably under bad
 * lighting at a venue door.
 *
 * Purely presentational — no data fetching. The QR is rendered BLACK-on-WHITE
 * (never tinted teal) with the Tikèm logo knocked out of the center.
 */
export default function TicketQRCard({
  qrValue,
  eventTitle,
  dateLabel,
  tierName,
  holderName,
  orderRef,
  style,
}: TicketQRCardProps) {
  const date = cleanLabel(dateLabel);
  const tier = cleanLabel(tierName);
  const holder = cleanLabel(holderName);
  const ref = cleanLabel(orderRef);

  return (
    <View style={[styles.card, style]}>
      <Text style={styles.title} numberOfLines={2}>
        {eventTitle}
      </Text>
      {date ? <Text style={styles.date}>{date}</Text> : null}

      <View style={styles.qrWrapper}>
        <QRCode
          value={qrValue || 'no-ticket-id'}
          size={200}
          color="#000000"
          backgroundColor="#FFFFFF"
          logo={require('../assets/tikem_logo_color.png')}
          logoSize={44}
          logoBackgroundColor="#FFFFFF"
          logoBorderRadius={radius.poster}
        />
      </View>

      {tier ? <Text style={styles.tier}>{tier}</Text> : null}
      {holder ? <Text style={styles.holder}>{holder}</Text> : null}
      {ref ? <Text style={styles.orderRef}>Order #{ref}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000000',
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 27,
  },
  date: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
    marginTop: 4,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginTop: spacing.xl,
  },
  tier: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  holder: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
    marginTop: 2,
  },
  orderRef: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.45)',
    textAlign: 'center',
    marginTop: spacing.md,
    letterSpacing: 0.5,
  },
});
