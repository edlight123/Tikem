import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { X, Ticket, Share2 } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius, spacing } from '../theme/tokens';
import { safeFormatForLanguage } from '../lib/dates';
import { shareEvent } from '../lib/share';
import FollowButton from './FollowButton';
import AddToCalendarButton from './AddToCalendarButton';

interface PurchaseSuccessSheetProps {
  visible: boolean;
  /** Dismiss WITHOUT navigating — the attendee stays on the event page. */
  onClose: () => void;
  /** Primary action: go to the Tickets tab. */
  onViewTickets: () => void;
  event: any;
  /** How many tickets this purchase produced, for the "N tickets" chip. */
  quantity: number;
}

/**
 * The confirmation an attendee sees the moment a purchase or free claim lands.
 *
 * Replaces a bare Alert (paid) and an instant jump to the Tickets tab (free).
 * Both told the buyer nothing and gave them nowhere to go next; posh uses this
 * moment to confirm the event, then offer the things people actually do right
 * after buying — look at the ticket, put it in the calendar, tell a friend,
 * follow the organizer for updates.
 */
export default function PurchaseSuccessSheet({
  visible,
  onClose,
  onViewTickets,
  event,
  quantity,
}: PurchaseSuccessSheetProps) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = getStyles(colors);

  const start = event?.start_datetime ? new Date(event.start_datetime) : null;
  const startValid = start && !Number.isNaN(start.getTime()) ? start : null;

  const where = [event?.venue_name, event?.city].filter(Boolean).join(' · ');
  const when = startValid
    ? safeFormatForLanguage(startValid, 'EEE, MMM d · h:mm a', language)
    : '';
  const meta = [when, where].filter(Boolean).join('  ·  ');

  const countLabel =
    quantity === 1
      ? t('purchaseSuccess.ticketOne')
      : t('purchaseSuccess.ticketMany').replace('{count}', String(quantity));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <Text style={styles.headline}>{t('purchaseSuccess.title')}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event?.title}
            </Text>
            <View style={styles.metaRow}>
              {!!meta && (
                <Text style={styles.meta} numberOfLines={2}>
                  {meta}
                </Text>
              )}
              <View style={styles.countChip}>
                <Text style={styles.countChipText}>{countLabel}</Text>
              </View>
            </View>

            {/* What people actually do next. Follow first — it is the one that
                keeps them informed if anything about the event changes. */}
            {!!event?.organizer_id && (
              <FollowButton organizerId={event.organizer_id} style={styles.follow} />
            )}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.action}
                onPress={onViewTickets}
                accessibilityRole="button"
              >
                <Ticket size={20} color={colors.text} />
                <Text style={styles.actionLabel}>{t('purchaseSuccess.viewTicket')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.action}
                onPress={() => shareEvent(event, language)}
                accessibilityRole="button"
              >
                <Share2 size={20} color={colors.text} />
                <Text style={styles.actionLabel}>{t('purchaseSuccess.share')}</Text>
              </TouchableOpacity>
            </View>

            {/* The existing calendar control, so the sheet cannot drift from
                the behaviour the event page already ships. */}
            {!!startValid && (
              <AddToCalendarButton event={event} style={styles.calendar} />
            )}

            <TouchableOpacity
              style={styles.primary}
              onPress={onViewTickets}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{t('purchaseSuccess.goToTickets')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl,
      maxHeight: '88%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    headline: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 40,
      lineHeight: 44,
      color: colors.text,
    },
    eventTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: 6,
    },
    meta: {
      flex: 1,
      fontSize: 14,
      color: colors.textSecondary,
    },
    countChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.chip,
      borderWidth: 1,
      borderColor: colors.border,
    },
    countChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    follow: {
      marginTop: spacing.xl,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.md,
    },
    action: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 16,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    calendar: {
      marginTop: spacing.md,
    },
    primary: {
      marginTop: spacing.xl,
      height: 56,
      borderRadius: radius.button,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.background,
    },
  });
