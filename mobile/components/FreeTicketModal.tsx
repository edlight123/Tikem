import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { X, Plus, Minus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { colors as T, radius, spacing } from '../theme/tokens';
import WhitePillCTA from './WhitePillCTA';
import type { Attribution } from '../lib/attribution';
import { MAX_FREE_TICKETS_PER_PERSON } from '../lib/ticketPricing';
import { PlusOneFields, plusOnesPayload, resizePlusOnes, type PlusOneDraft } from './AttendRequestSheet';

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
  /**
   * Plus-ones the guest may name on this free event (lib/attendRequests,
   * already capped by the free limit). 0 = no naming; the plain claim is
   * unchanged. Names are optional here: only a fully named set is sent.
   */
  allowedPlusOnes?: number;
  /**
   * Opens this event's tickets. Used by the "you already have N tickets" answer
   * (claim-free `alreadyClaimed`), where nothing new was issued so the purchase
   * success flow (`onSuccess`) would be the wrong confirmation.
   */
  onViewTickets?: () => void;
  /** The server said this buyer already holds the free claim; carries their ticket count. */
  onAlreadyClaimed?: (count: number) => void;
}

/**
 * The 200 answer to a repeat claim. `alreadyClaimed` / `code` are additive
 * fields; the stable English message is the fallback for a server deployed
 * before them, so this build still never congratulates a repeat claim.
 */
function isAlreadyClaimedResponse(r: any): boolean {
  return (
    r?.alreadyClaimed === true ||
    r?.code === 'already_claimed' ||
    r?.message === 'You already claimed a ticket for this event.'
  );
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
  allowedPlusOnes = 0,
  onViewTickets,
  onAlreadyClaimed,
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
  const maxQuantity = Math.min(MAX_FREE_TICKETS_PER_PERSON, remainingTickets);
  // The quantity actually claimed: the upstream selection when locked, else the
  // stepper value.
  const claimQuantity = isLocked ? (lockedQuantity as number) : quantity;
  // Named plus-ones: the extra tickets of an unlocked claim, when allowed.
  const namedSlots = !isLocked && allowedPlusOnes > 0 ? Math.min(allowedPlusOnes, Math.max(0, claimQuantity - 1)) : 0;
  const [plusOnes, setPlusOnes] = useState<PlusOneDraft[]>([]);
  useEffect(() => {
    setPlusOnes((prev) => resizePlusOnes(prev, namedSlots));
  }, [namedSlots]);
  const namedPlusOnes =
    namedSlots > 0 && namedSlots === claimQuantity - 1 && plusOnes.length === namedSlots && plusOnes.every((p) => p.firstName.trim())
      ? plusOnesPayload(plusOnes)
      : null;

  // Reset the stepper whenever the sheet reopens so a previous order's count
  // never carries over into the next claim.
  useEffect(() => {
    if (visible) {
      setQuantity(1);
      setPlusOnes([]);
    }
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
      const result = await backendJson<{
        count?: number;
        message?: string;
        alreadyClaimed?: boolean;
        code?: string;
      }>(
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
            // Only a fully named set; otherwise the plain quantity claim.
            ...(namedPlusOnes ? { plusOnes: namedPlusOnes } : {}),
          }),
        }
      );

      setLoading(false);

      // Nothing was issued: they already hold this event's free claim. Say so,
      // with their real count, instead of the "you got N tickets" success copy.
      if (isAlreadyClaimedResponse(result)) {
        const held = Math.max(1, Number(result?.count) || 0);
        onClose();
        onAlreadyClaimed?.(held);
        setTimeout(() => {
          showAlert(t('freeTicket.alreadyTitle'), pc('freeTicket.alreadyBody', held), [
            { text: t('freeTicket.viewTickets'), onPress: onViewTickets ?? onSuccess },
            { text: t('common.ok'), style: 'cancel' },
          ]);
        }, 300);
        return;
      }

      const issued = Number(result?.count ?? claimQuantity) || claimQuantity;
      console.log('=== SUCCESS ===', issued);

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

  const stepperDisabledDec = quantity <= 1 || loading;
  const stepperDisabledInc = quantity >= maxQuantity || loading;
  const ticketWord = claimQuantity === 1 ? t('freeTicket.ticketWord.one') : t('freeTicket.ticketWord.other');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => !loading && onClose()}
          accessibilityLabel={t('common.cancel')}
        />
        <View style={styles.modalContainer}>
          {/* Paints below the sheet's edge, so the event page's sticky bar can never
              show through a gap under the sheet (see ContactOrganizerModal). */}
          <View pointerEvents="none" style={styles.bottomFill} />
          <View style={styles.handle} />

          {/* Editorial header: serif lowercase title, the event quietly beneath. */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {t('freeTicket.title').toLowerCase()}
              </Text>
              {/* On a mixed free+paid event name the free tier the buyer picked;
                  the generic "free event" line would be a lie there. */}
              <Text style={styles.eventLine} numberOfLines={1}>
                {eventTitle}
                {tierName ? `  ·  ${tierName}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <X size={18} color={T.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* One filled row: label left, a small stepper (or the locked count) right. */}
          <View style={styles.stepperRow}>
            <View style={styles.stepperLabelWrap}>
              <Text style={styles.stepperLabel}>{tf('freeTicket.ticketsLabel', 'Tickets')}</Text>
              {!isUnlimited && (
                <Text style={styles.stepperMeta}>{rc('freeTicket.availableCount', remainingTickets)}</Text>
              )}
            </View>
            {isLocked ? (
              <Text style={styles.lockedCount}>
                {claimQuantity} {ticketWord.toLowerCase()}
              </Text>
            ) : (
              <View style={styles.stepper}>
                <TouchableOpacity
                  onPress={handleDecrease}
                  disabled={stepperDisabledDec}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.stepBtn, stepperDisabledDec && styles.stepBtnOff]}
                  accessibilityRole="button"
                  accessibilityLabel="-"
                >
                  <Minus size={14} color={T.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.stepCount}>{quantity}</Text>
                <TouchableOpacity
                  onPress={handleIncrease}
                  disabled={stepperDisabledInc}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.stepBtn, stepperDisabledInc && styles.stepBtnOff]}
                  accessibilityRole="button"
                  accessibilityLabel="+"
                >
                  <Plus size={14} color={T.textPrimary} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {!isLocked && quantity >= maxQuantity && maxQuantity < 10 && (
            <Text style={styles.limitText}>{pc('freeTicket.maxNote', maxQuantity)}</Text>
          )}

          {namedSlots > 0 && (
            <View style={styles.plusOneSection}>
              <Text style={styles.plusOneTitle}>{t('attendRequests.claimPlusOne.title')}</Text>
              <Text style={styles.plusOneHint}>{t('attendRequests.claimPlusOne.hint')}</Text>
              <PlusOneFields value={plusOnes} onChange={setPlusOnes} editable={!loading} />
            </View>
          )}

          {/* A quiet total line, not a filled box with a giant amount. */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('freeTicket.total')}</Text>
            <Text style={styles.totalValue}>{t('common.free')}</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              disabled={loading}
              style={styles.cancelButton}
              accessibilityRole="button"
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <WhitePillCTA
              compact
              variant="rsvp"
              label={pc('freeTicket.claimButton', claimQuantity)}
              onPress={handleClaimTickets}
              loading={loading}
              disabled={remainingTickets <= 0}
              style={styles.claimButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Black canvas, one 4px radius, fills not outlines, teal kept out of it entirely
// (the white pill is the primary). About 40% shorter than the sheet it replaced.
const getStyles = (_colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: T.bg,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    maxHeight: '85%',
  },
  bottomFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    height: 400,
    backgroundColor: T.bg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: T.surfaceRaised,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 26,
    lineHeight: 30,
    color: T.textPrimary,
  },
  eventLine: {
    marginTop: 2,
    fontSize: 13,
    color: T.textSecondary,
  },
  closeButton: {
    paddingTop: 6,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.surface,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 10,
  },
  stepperLabelWrap: {
    flex: 1,
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
  },
  stepperMeta: {
    marginTop: 1,
    fontSize: 12,
    color: T.textTertiary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: {
    opacity: 0.35,
  },
  stepCount: {
    minWidth: 16,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: T.textPrimary,
  },
  lockedCount: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
    paddingRight: 6,
  },
  limitText: {
    fontSize: 12,
    color: T.textTertiary,
    marginTop: spacing.sm,
  },
  plusOneSection: {
    marginTop: spacing.lg,
  },
  plusOneTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 20,
    color: T.textPrimary,
  },
  plusOneHint: {
    fontSize: 12,
    color: T.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: 2,
  },
  totalLabel: {
    fontSize: 13,
    color: T.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cancelButton: {
    height: 46,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textSecondary,
  },
  claimButton: {
    flex: 1,
  },
});
