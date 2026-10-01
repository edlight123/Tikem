import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { colors as T, radius, spacing } from '../../theme/tokens';
import { formatMoneyLines } from '../../lib/orderDisplay';
import type { MoneyLine } from '../../lib/api/eventOrders';

interface Props {
  visible: boolean;
  /** What the buyer gets back, per currency, as the server will refund it. */
  totals: MoneyLine[];
  ticketCount: number;
  totalTickets: number;
  /** Refund rails involved: 'stripe' | 'stripe_connect' | 'manual'. */
  rails: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The confirmation step before a refund (destructive, irreversible). States the
 * exact amount and currency the server will refund — per currency, never
 * summed across them — how the money travels, and that the tickets stop
 * working. Same sheet anatomy as DeleteAccountSheet: a quiet red-wash confirm,
 * never a solid red slab, and no white pill (that belongs to the screen).
 */
export default function RefundConfirmSheet({
  visible,
  totals,
  ticketCount,
  totalTickets,
  rails,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const card = rails.some((r) => r === 'stripe' || r === 'stripe_connect');
  const manual = rails.includes('manual');
  const amountText = formatMoneyLines(totals);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
      <View style={styles.anchor} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('organizerOrders.refundSheet.title')}</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('organizerOrders.refundSheet.cancel')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* The figure, big and unambiguous: an inset fill inside the sheet. */}
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>{t('organizerOrders.refundSheet.amountLabel')}</Text>
            {totals.map((line) => (
              <Text
                key={line.currency}
                style={styles.amount}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {formatMoneyLines([line])}
              </Text>
            ))}
            <Text style={styles.ticketsLine}>
              {t('organizerOrders.refundSheet.ticketsLine', { n: ticketCount, total: totalTickets })}
            </Text>
          </View>

          {card ? <Text style={styles.body}>{t('organizerOrders.refundSheet.railCard')}</Text> : null}
          {manual ? <Text style={styles.body}>{t('organizerOrders.refundSheet.railManual')}</Text> : null}
          <Text style={[styles.body, styles.warning]}>{t('organizerOrders.refundSheet.voidNote')}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>{t('organizerOrders.refundSheet.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.destructiveBtn, busy && styles.disabled]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${t('organizerOrders.refundSheet.confirm')} ${amountText}`}
              accessibilityState={{ busy, disabled: busy }}
            >
              {busy ? (
                <ActivityIndicator color={T.red} />
              ) : (
                <Text style={styles.destructiveText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {t('organizerOrders.refundSheet.confirm')} · {amountText}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    anchor: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    amountBlock: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      paddingVertical: 18,
      paddingHorizontal: spacing.lg,
      marginBottom: 16,
    },
    amountLabel: {
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    amount: {
      fontSize: 32,
      fontWeight: '700',
      letterSpacing: -0.6,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    ticketsLine: {
      marginTop: 6,
      fontSize: 13,
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: 10 },
    warning: { color: colors.text },
    buttonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
    cancelBtn: {
      flex: 1,
      height: 52,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
    // Destructive, but quiet: red text on a faint red wash.
    destructiveBtn: {
      flex: 1.4,
      height: 52,
      borderRadius: radius.button,
      backgroundColor: T.redMuted,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    destructiveText: { fontSize: 15, fontWeight: '700', color: T.red, fontVariant: ['tabular-nums'] },
    disabled: { opacity: 0.5 },
  });
