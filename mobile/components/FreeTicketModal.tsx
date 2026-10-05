import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ticket, X, Plus, Minus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';
import type { Attribution } from '../lib/attribution';

/**
 * Refusals caused by the promo code rather than by the tickets themselves. For
 * these the order is still purchasable at its real price, so the buyer is offered
 * normal checkout instead of a dead end.
 */
const PROMO_FAILURE_CODES = new Set([
  'promo_invalid',
  'promo_exhausted',
  'promo_not_free',
  'promo_requires_tier',
  'promo_redeem_failed',
  // A paid tier reaching the free path at all means the discount didn't hold.
  'tier_not_free',
]);

interface FreeTicketModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  userId: string;
  userEmail: string;
  userName: string;
  event: any;
  onSuccess: () => void;
  /** Optional selected tier id; when absent the server resolves the event's free tier. */
  tierId?: string;
  /** Optional tier name, shown instead of the generic "FREE EVENT" label. */
  tierName?: string;
  /**
   * Quantity already chosen upstream (the tier selector). When set, this modal
   * confirms that quantity instead of asking again — a second stepper would let
   * the buyer silently contradict the tier-level availability they just picked
   * against.
   */
  lockedQuantity?: number;
  /**
   * Promo code the buyer applied in the tier selector (raw code or promo doc id).
   * Forwarded so the SERVER can re-validate it and decide whether the order really
   * prices out at 0 — the client's arithmetic is never the authority. Without this
   * a 100%-off code on a PAID tier lands here and is refused ("not free"), which
   * is the bug this thread fixes.
   */
  promoCode?: string;
  /** Promoter ref (`?ref=` on the event link) — a free RSVP still credits them. */
  refCode?: string;
  /** Tracking-link / utm attribution from the deep link; re-resolved server-side. */
  attribution?: Attribution | null;
  /**
   * Escape hatch for a claim the server refuses on promo grounds (code invalid,
   * spent, or only a partial discount). Lets the buyer continue to normal
   * checkout instead of being stranded in a sheet that can't succeed.
   */
  onCheckoutFallback?: () => void;
}

export default function FreeTicketModal({
  visible,
  onClose,
  eventId,
  eventTitle,
  userId,
  userEmail,
  userName,
  event,
  onSuccess,
  tierId,
  tierName,
  lockedQuantity,
  promoCode,
  refCode,
  attribution,
  onCheckoutFallback,
}: FreeTicketModalProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);

  // t() has no interpolation: substitute {count} manually. `rc` replaces the
  // placeholder; `pc` also picks the singular/plural variant by count.
  const rc = (key: string, n: number) => t(key).replace('{count}', String(n));
  const pc = (base: string, n: number) => rc(`${base}.${n === 1 ? 'one' : 'other'}`, n);
  // t() echoes the key back when it is missing from the dictionaries (same guard
  // as `eventDetail.startsIn` in EventDetailScreen), so every string added here
  // reads as English until the keys land centrally — never as a raw key.
  const tf = (key: string, fallback: string) => (t(key) === key ? fallback : t(key));

  const isLocked = typeof lockedQuantity === 'number' && lockedQuantity > 0;
  // The web stores total_tickets 0 (or leaves it unset) to mean UNLIMITED, so
  // only a positive cap limits the claim.
  const totalCap = Number(event.total_tickets) || 0;
  const isUnlimited = totalCap <= 0;
  const remainingTickets = isUnlimited
    ? Infinity
    : totalCap - (Number(event.tickets_sold) || 0);
  const maxQuantity = Math.min(10, remainingTickets);
  // The quantity actually claimed: the upstream selection when locked, else the
  // stepper value.
  const claimQuantity = isLocked ? (lockedQuantity as number) : quantity;

  // Reset the stepper whenever the sheet reopens so a previous order's count
  // never carries over into the next claim.
  useEffect(() => {
    if (visible) setQuantity(1);
  }, [visible]);

  const handleIncrease = () => {
    if (quantity < maxQuantity) {
      setQuantity(quantity + 1);
    }
  };

  const handleDecrease = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
    }
  };

  /**
   * Map a `code` from /api/tickets/claim-free to buyer-facing copy. Anything
   * unrecognised (including an old server that sends no code at all) falls back
   * to the existing generic line rather than leaking English server text.
   */
  const localizedClaimError = (code: string): string => {
    switch (code) {
      case 'promo_invalid':
        return tf('freeTicket.errors.promoInvalid', 'This promo code is no longer valid for this event.');
      case 'promo_exhausted':
        return tf('freeTicket.errors.promoExhausted', 'This promo code has reached its usage limit.');
      case 'promo_not_free':
        return tf(
          'freeTicket.errors.promoNotFree',
          'This promo code does not cover the full price of these tickets.'
        );
      case 'promo_requires_tier':
        return tf('freeTicket.errors.promoRequiresTier', 'Choose a ticket type before using this promo code.');
      case 'promo_redeem_failed':
        return tf('freeTicket.errors.promoFailed', 'We could not apply this promo code. Please try again.');
      case 'tier_not_free':
      case 'event_not_free':
        return tf('freeTicket.errors.notFree', 'These tickets are not free.');
      case 'tier_inactive':
      case 'tier_not_found':
        return tf('freeTicket.errors.tierUnavailable', 'This ticket type is no longer available.');
      case 'tier_not_started':
        return tf('freeTicket.errors.salesNotStarted', 'Ticket sales have not started yet.');
      case 'tier_sales_ended':
        return tf('freeTicket.errors.salesEnded', 'Ticket sales have ended.');
      case 'already_claimed':
        return tf('freeTicket.errors.alreadyClaimed', "You already claimed tickets for this event. Check your email for them.");
      case 'promo_already_used':
        return tf('freeTicket.errors.promoAlreadyUsed', "You have already used this promo code.");
      case 'event_cancelled':
        return tf('freeTicket.errors.eventCancelled', "This event has been cancelled.");
      case 'event_unavailable':
        return tf('freeTicket.errors.eventUnavailable', "This event is not available right now.");
      case 'event_ended':
        return tf('freeTicket.errors.eventEnded', "This event has already ended.");
      case 'tier_sold_out':
      case 'no_tickets_available':
        return t('freeTicket.soldOutBody');
      case 'limited_availability':
        return tf('freeTicket.errors.limited', 'There are not enough tickets left for this order.');
      case 'too_many_tickets':
        return tf('freeTicket.errors.tooMany', 'You can claim at most 10 free tickets at a time.');
      case 'access_code_required':
        return tf('freeTicket.errors.accessCode', 'This event needs an access code.');
      default:
        return t('freeTicket.errorBody');
    }
  };

  const handleClaimTickets = async () => {
    if (remainingTickets <= 0) {
      showAlert(t('freeTicket.soldOutTitle'), t('freeTicket.soldOutBody'));
      return;
    }

    if (claimQuantity > remainingTickets) {
      showAlert(t('freeTicket.limitedTitle'), pc('freeTicket.limitedBody', remainingTickets));
      return;
    }

    setLoading(true);

    try {
      console.log('=== CLAIMING FREE TICKETS ===');
      console.log('Event ID:', eventId, 'Tier:', tierId || '(auto)');
      console.log('Quantity:', claimQuantity, 'User ID:', userId);

      // Issue through the server (Admin SDK) rather than writing `tickets` docs
      // from the client. The endpoint is the ONLY free-issuance path that runs the
      // full guard set: password-gate access grant, tier price/is_active/sale
      // window, per-user free-claim dedup, and the SAME atomic
      // reserveInventoryAtomic transaction the paid fulfillments use — so
      // concurrent claims can't oversell the event or the tier. The previous
      // client-side write incremented `tickets_sold` with a read-modify-write,
      // which silently loses increments under concurrency.
      const result = await backendJson<{ count?: number; message?: string }>(
        '/api/tickets/claim-free',
        {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            quantity: claimQuantity,
            ...(tierId ? { tierId } : {}),
            // Routing hint only: the server re-resolves this code against the
            // event's own promo docs and recomputes the discount before it agrees
            // that anything is free.
            ...(promoCode ? { promoCode } : {}),
            ...(refCode ? { refCode } : {}),
          ...(attribution ? { attribution } : {}),
          }),
        }
      );

      const issued = Number(result?.count ?? claimQuantity) || claimQuantity;
      console.log('=== SUCCESS ===', issued);

      setLoading(false);
      onClose();

      // Call onSuccess after a short delay to ensure modal is closed
      setTimeout(() => {
        showAlert(
          t('freeTicket.successTitle'),
          pc('freeTicket.successBody', issued),
          [
            {
              text: t('freeTicket.viewTickets'),
              onPress: onSuccess
            },
            {
              text: t('common.ok'),
              style: 'cancel'
            }
          ]
        );
      }, 300);
    } catch (error: any) {
      console.error('=== ERROR CLAIMING TICKETS ===');
      console.error('Error details:', error);
      // The server sends a stable `code` alongside its English `error` string.
      // Localize off the code; the raw server sentence is for logs only and must
      // never be the copy a buyer reads.
      const code = typeof error?.code === 'string' ? error.code : '';
      const message = localizedClaimError(code);
      // A promo refusal isn't a dead end — the buyer can still pay for the ticket.
      const canFallBack = Boolean(onCheckoutFallback) && PROMO_FAILURE_CODES.has(code);

      showAlert(
        t('common.error'),
        message,
        canFallBack
          ? [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: tf('freeTicket.continueToCheckout', 'Continue to checkout'),
                onPress: () => {
                  onClose();
                  // Let the sheet finish dismissing before the next one opens.
                  setTimeout(() => onCheckoutFallback?.(), 300);
                },
              },
            ]
          : undefined
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.handle} />
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ticket size={24} color={colors.primary} />
              </View>
              <Text style={styles.headerTitle}>{t('freeTicket.title')}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Event Info */}
          <View style={styles.eventInfo}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {eventTitle}
            </Text>
            {/* On a mixed free+paid event the generic "FREE EVENT" line would be a
                lie — name the free tier the buyer actually picked instead. */}
            <Text style={styles.freeLabel}>{tierName || t('freeTicket.freeEvent')}</Text>
          </View>

          {/* Quantity — a stepper when this sheet owns the choice, otherwise a
              read-only confirmation of the quantity picked in the tier selector. */}
          <View style={styles.quantitySection}>
            <View style={styles.quantityHeader}>
              <Text style={styles.sectionLabel}>{t('freeTicket.quantityLabel')}</Text>
              {!isUnlimited && (
                <Text style={styles.availabilityText}>
                  {rc('freeTicket.availableCount', remainingTickets)}
                </Text>
              )}
            </View>

            {isLocked ? (
              <View style={styles.quantityDisplay}>
                <Text style={styles.quantityNumber}>{claimQuantity}</Text>
                <Text style={styles.quantityLabel}>
                  {claimQuantity === 1
                    ? t('freeTicket.ticketWord.one')
                    : t('freeTicket.ticketWord.other')}
                </Text>
              </View>
            ) : (
            <View style={styles.quantityControls}>
              <TouchableOpacity
                onPress={handleDecrease}
                disabled={quantity <= 1 || loading}
                style={[styles.quantityButton, (quantity <= 1 || loading) && styles.quantityButtonDisabled]}
              >
                <Minus size={20} color={quantity <= 1 || loading ? colors.textSecondary : colors.primary} />
              </TouchableOpacity>
              
              <View style={styles.quantityDisplay}>
                <Text style={styles.quantityNumber}>{quantity}</Text>
                <Text style={styles.quantityLabel}>
                  {quantity === 1 ? t('freeTicket.ticketWord.one') : t('freeTicket.ticketWord.other')}
                </Text>
              </View>
              
              <TouchableOpacity
                onPress={handleIncrease}
                disabled={quantity >= maxQuantity || loading}
                style={[styles.quantityButton, (quantity >= maxQuantity || loading) && styles.quantityButtonDisabled]}
              >
                <Plus size={20} color={quantity >= maxQuantity || loading ? colors.textSecondary : colors.primary} />
              </TouchableOpacity>
            </View>
            )}

            {!isLocked && quantity >= maxQuantity && maxQuantity < 10 && (
              <Text style={styles.limitText}>
                {pc('freeTicket.maxNote', maxQuantity)}
              </Text>
            )}
          </View>

          {/* Summary */}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('freeTicket.total')}</Text>
              <Text style={styles.summaryValue}>{t('freeTicket.free')}</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelButton}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleClaimTickets}
              style={[styles.claimButton, loading && styles.claimButtonDisabled]}
              disabled={loading || remainingTickets <= 0}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.claimButtonText}>
                  {pc('freeTicket.claimButton', claimQuantity)}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  eventInfo: {
    backgroundColor: colors.primary + '10',
    padding: 16,
    borderRadius: radius.md,
    marginBottom: 24,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  freeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  quantitySection: {
    marginBottom: 24,
  },
  quantityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  availabilityText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  quantityButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonDisabled: {
    borderColor: colors.border,
    opacity: 0.5,
  },
  quantityDisplay: {
    alignItems: 'center',
    minWidth: 100,
  },
  quantityNumber: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  quantityLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  limitText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  summary: {
    backgroundColor: colors.surfaceRaised,
    padding: 16,
    borderRadius: radius.md,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  claimButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  claimButtonDisabled: {
    opacity: 0.6,
  },
  claimButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
