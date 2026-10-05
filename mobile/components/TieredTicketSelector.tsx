import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { X, Minus, Plus, Tag, ChevronDown, ChevronUp } from 'lucide-react-native';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useI18n } from '../contexts/I18nContext';
import { normalizePromoValidationResponse } from '../lib/promoCodes';
import { useTheme } from '../contexts/ThemeContext';
import { formatCurrency } from '../lib/currency';
import { computeSelectionTotal, isFreeTier } from '../lib/ticketPricing';
import { priceOrder } from '../lib/buyerPricing';
import WhitePillCTA from './WhitePillCTA';
import { radius } from '../theme/tokens';

interface TicketTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  total_quantity: number;
  sold_quantity: number;
  sales_start: string | null;
  sales_end: string | null;
  unlimited?: boolean;
  /** Organizer switched this tier off. The server refuses it, so it is never offered. */
  is_active?: boolean;
}

// Group discounts used to be fetched and applied here, but neither checkout route
// (create-payment-intent, moncash-button/initiate) applies them and the web
// checkout never shows them, so a buyer saw a lower total than they were charged.
// They stay out of the buyer's total until the server prices them.

interface PromoCodeValidation {
  valid: boolean;
  discount_percentage?: number;
  discount_amount?: number;
  error?: string;
}

/** Extra context about the chosen tier, so the caller can route and label the order. */
export interface PurchaseSelectionMeta {
  /** Display name of the chosen tier (e.g. "Free RSVP"). */
  tierName: string;
  /**
   * True when the order costs nothing. The caller MUST issue such an order
   * through the free-claim path rather than any payment gateway.
   */
  isFree: boolean;
  /**
   * Order total BEFORE any discount, in major units. Kept so the caller can show
   * the real price if a promo-zeroed order has to fall back to checkout.
   */
  grossPrice: number;
  /**
   * The order only reaches 0 because of the promo code — the tiers themselves
   * cost money. A hint for routing/labelling only: the server re-validates the
   * promo and has the final say on whether anything is issued for free.
   */
  promoZeroed: boolean;
}

interface TieredTicketSelectorProps {
  eventId: string;
  visible: boolean;
  onClose: () => void;
  onPurchase: (
    tierId: string,
    finalPrice: number,
    quantity: number,
    promoCode?: string,
    meta?: PurchaseSelectionMeta
  ) => void;
  currency?: string;
  /** Event country — decides whether the service fee is added to the total. */
  country?: string | null;
  /** The organizer's own absorb/pass-on choice, when they made one. */
  feeIncidence?: string | null;
}

interface TierQuantity {
  [tierId: string]: number;
}

/**
 * Below this remaining count the availability line is worth the pixels ("3
 * available"); above it the tier is effectively plentiful and the line is
 * dropped so a list of 5+ tiers stays scannable. Matches the 10-per-order cap
 * in `updateTierQuantity` — once stock is under the cap it constrains the buyer.
 */
const LOW_STOCK_THRESHOLD = 10;

/** Visible stepper buttons are 28pt; this slop lifts the touch target to 44pt. */
const STEPPER_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };


export default function TieredTicketSelector({
  eventId,
  visible,
  onClose,
  onPurchase,
  currency,
  country,
  feeIncidence,
}: TieredTicketSelectorProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const displayCurrency = String(currency || 'HTG').toUpperCase();
  const [tiers, setTiers] = useState<TicketTier[]>([]);
  /** True when the tier fetch itself failed, as opposed to an event that
   *  genuinely has no tiers. The two look identical without it. */
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Store quantity per tier
  const [tierQuantities, setTierQuantities] = useState<TierQuantity>({});
  const [promoCode, setPromoCode] = useState('');
  const [promoValidation, setPromoValidation] = useState<PromoCodeValidation | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);
  // Promo entry is collapsed behind a quiet toggle — it's optional, so it
  // shouldn't cost a permanent labelled section. Any validation result (applied
  // OR failed) forces it open so an applied code can never hide behind a tap.
  const [promoOpen, setPromoOpen] = useState(false);
  const promoExpanded = promoOpen || !!promoValidation;

  useEffect(() => {
    if (visible) {
      fetchTiers();
    }
  }, [visible, eventId]);

  const fetchTiers = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      console.log('[TieredTicketSelector] Fetching tiers for event:', eventId);
      
      const tiersQuery = query(
        collection(db, 'ticket_tiers'),
        where('event_id', '==', eventId),
        orderBy('sort_order', 'asc')
      );
      
      const tiersSnapshot = await getDocs(tiersQuery);
      const tiersData = (tiersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as TicketTier[])
        // A tier the organizer deactivated is refused by both checkout routes
        // ("This ticket tier is not available."), so it is not offered at all.
        .filter(tier => tier.is_active !== false);
      
      console.log('[TieredTicketSelector] Fetched tiers:', tiersData.length);
      setTiers(tiersData);
    } catch (error) {
      console.error('[TieredTicketSelector] Error fetching tiers:', error);
      // Record the failure rather than swallowing it. This used to just
      // setTiers([]) with the note "so modal still shows", which turned any
      // fetch error — a missing composite index, a rules change, a dropped
      // connection — into a sheet with a "CHOOSE TICKETS" heading and nothing
      // under it. A buyer sees no tickets and no reason, and the failure is
      // invisible in a TestFlight screenshot.
      setTiers([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      setPromoValidation(null);
      return;
    }

    setValidatingPromo(true);
    try {
      const apiUrl = (
        process.env.EXPO_PUBLIC_API_URL ||
        process.env.EXPO_PUBLIC_WEB_URL ||
        'https://www.tikem.co'
      ).replace(/\/$/, '');
      const response = await fetch(
        `${apiUrl}/api/promo-codes?eventId=${eventId}&code=${encodeURIComponent(promoCode)}`
      );
      const data = await response.json();
      const normalized = normalizePromoValidationResponse(data);
      if (!normalized.valid) {
        // The server's wording is English and developer-facing; keep it in the log
        // and show the buyer a translated message instead.
        console.warn('[TieredTicketSelector] promo code rejected:', normalized.error);
        setPromoValidation({ valid: false, error: promoErrorMessage(normalized.error) });
      } else {
        setPromoValidation(normalized);
      }
    } catch (error) {
      console.error('Error validating promo code:', error);
      setPromoValidation({ valid: false, error: t('ticketSelector.promoErrors.failed') });
    } finally {
      setValidatingPromo(false);
    }
  };

  /** Map the validation endpoint's English refusal to translated copy. */
  const promoErrorMessage = (raw?: string): string => {
    const text = String(raw || '').toLowerCase();
    if (text.includes('expired')) return t('ticketSelector.promoErrors.expired');
    if (text.includes('maximum uses')) return t('ticketSelector.promoErrors.maxUses');
    if (text.includes('not yet valid')) return t('ticketSelector.promoErrors.notYetValid');
    if (text.includes('inactive')) return t('ticketSelector.promoErrors.inactive');
    if (text.includes('invalid') || text.includes('not found')) return t('ticketSelector.promoErrors.invalid');
    return t('ticketSelector.promoErrors.failed');
  };

  const isTierAvailable = (tier: TicketTier): boolean => {
    const now = new Date();

    if (tier.is_active === false) return false;
    
    // Check sales period
    if (tier.sales_start && new Date(tier.sales_start) > now) {
      return false;
    }
    if (tier.sales_end && new Date(tier.sales_end) < now) {
      return false;
    }
    
    // Check availability
    const available = tier.total_quantity - tier.sold_quantity;
    return available > 0;
  };

  // Format an ISO sale-start for the "On sale {date}" label (short month + day).
  const formatOnSaleDate = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  const getAvailableQuantity = (tier: TicketTier): number => {
    return tier.total_quantity - tier.sold_quantity;
  };

  const getTotalQuantity = (): number => {
    return Object.values(tierQuantities).reduce((sum, qty) => sum + qty, 0);
  };

  /**
   * Order total in MAJOR units. Summing and discounting happens on integer cents
   * inside `computeSelectionTotal` so repeated adds and a percentage discount
   * can't accumulate binary-float error (the old version summed floats and only
   * rounded at the very end).
   */
  const getTotalPrice = (): number => {
    const selections = tiers
      .map(tier => ({ price: tier.price, quantity: tierQuantities[tier.id] || 0 }))
      .filter(s => s.quantity > 0);

    // Only a code the server has validated changes the price. The discount is
    // per ticket, matching how both checkout routes price a promo.
    if (promoValidation?.valid) {
      return computeSelectionTotal(selections, {
        percentage: promoValidation.discount_percentage,
        amount: promoValidation.discount_amount,
      });
    }

    return computeSelectionTotal(selections);
  };

  const updateTierQuantity = (tierId: string, delta: number) => {
    const tier = tiers.find(t => t.id === tierId);
    if (!tier) return;
    
    const currentQty = tierQuantities[tierId] || 0;
    const available = getAvailableQuantity(tier);
    const newQty = Math.max(0, Math.min(currentQty + delta, available, 10));

    // Single-tier enforcement: only ONE ticket type may have a quantity at a
    // time. The purchase contract issues `firstTierWithQty` but charges the
    // combined `getTotalPrice()`; across mixed tiers that overcharges and
    // mis-issues. Keeping exactly one tier active makes the two consistent.
    // Raising a different tier resets the others to 0; decrementing keeps the
    // (already single) active tier.
    setTierQuantities(prev => {
      const next: TierQuantity = delta > 0 ? {} : { ...prev };
      next[tierId] = newQty;
      return next;
    });
  };

  const handlePurchase = () => {
    // For now, purchase the first tier with quantity
    // In future, we can support multi-tier purchases
    const firstTierWithQty = tiers.find(t => (tierQuantities[t.id] || 0) > 0);
    if (!firstTierWithQty) return;
    
    const quantity = tierQuantities[firstTierWithQty.id] || 0;
    const finalPrice = getTotalPrice();
    // Undiscounted total, on integer cents like every other amount here.
    const grossPrice = computeSelectionTotal([{ price: firstTierWithQty.price, quantity }]);

    // Only a code that validated is sent on. A rejected or never-applied code
    // would otherwise travel to checkout, where the server might still discount
    // it (or redeem it) while the buyer was shown the full price.
    const appliedPromo = promoValidation?.valid ? promoCode.trim() || undefined : undefined;

    onPurchase(firstTierWithQty.id, finalPrice, quantity, appliedPromo, {
      tierName: firstTierWithQty.name,
      // A 0 total (a free tier, or a 100%-off promo on a paid one) must not reach
      // a gateway — the caller uses this to pick the free-claim path.
      isFree: finalPrice <= 0,
      grossPrice,
      promoZeroed: finalPrice <= 0 && grossPrice > 0,
    });

    // Reset state
    setTierQuantities({});
    setPromoCode('');
    setPromoValidation(null);
    setPromoOpen(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('ticketSelector.title')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Tier Selection with Quantities */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>{t('ticketSelector.chooseTickets')}</Text>
                {tiers.length > 1 && (
                  <Text style={styles.sectionHint} numberOfLines={1}>
                    {t('ticketSelector.oneTypePerOrder')}
                  </Text>
                )}
              </View>

              {/* A failed fetch and an event with no tiers used to look
                  identical: an empty list. Say which it is, and give the buyer
                  the retry that turns a dead sheet into a second chance. */}
              {loadError && tiers.length === 0 && (
                <View style={styles.tierRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tierName}>
                      {t('ticketSelector.loadFailed')}
                    </Text>
                    <Text style={styles.tierMeta}>
                      {t('ticketSelector.loadFailedHint')}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={fetchTiers} accessibilityRole="button">
                    <Text style={[styles.tierName, { color: colors.primary }]}>
                      {t('ticketSelector.retry')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Loaded fine, but the organizer has not created any ticket
                  types: say so, instead of a heading over an empty sheet. */}
              {!loadError && tiers.length === 0 && (
                <View style={[styles.tierRow, styles.tierRowLast]} accessibilityRole="text">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tierName}>{t('ticketSelector.noTiers')}</Text>
                    <Text style={styles.tierMeta}>{t('ticketSelector.noTiersHint')}</Text>
                  </View>
                </View>
              )}

              {tiers.map((tier, index) => {
                const available = getAvailableQuantity(tier);
                const isAvailable = isTierAvailable(tier);
                const quantity = tierQuantities[tier.id] || 0;
                // On-sale gate (mirrors the web): empty bound = open. When not on
                // sale the stepper is hidden (isAvailable is false) and a subdued
                // label explains why instead of the generic sold-out copy.
                const now = new Date();
                const notYetOnSale = !!tier.sales_start && new Date(tier.sales_start) > now;
                const salesEnded = !!tier.sales_end && new Date(tier.sales_end) < now;
                const isSoldOut = !notYetOnSale && !salesEnded && !tier.unlimited && !isAvailable;
                // One quiet note per row, same precedence as before, except a
                // plentiful tier (unlimited, or stock above the per-order cap)
                // says nothing at all instead of spending a line on it.
                const note = notYetOnSale
                  ? t('ticketSelector.onSaleFrom').replace('{date}', formatOnSaleDate(tier.sales_start))
                  : salesEnded
                    ? t('ticketSelector.salesEnded')
                    : tier.unlimited
                      ? null
                      : !isAvailable
                        ? t('ticketSelector.soldOut')
                        : available <= LOW_STOCK_THRESHOLD
                          ? `${available} ${t('ticketSelector.available')}`
                          : null;
                const atMax = quantity >= available || quantity >= 10;

                return (
                  <View
                    key={tier.id}
                    style={[
                      styles.tierRow,
                      index === tiers.length - 1 && styles.tierRowLast,
                      !isAvailable && styles.tierRowDisabled,
                    ]}
                  >
                    <View style={styles.tierMain}>
                      <View style={styles.tierTitleLine}>
                        <Text
                          style={[
                            styles.tierName,
                            !isAvailable && styles.tierNameDisabled,
                          ]}
                          numberOfLines={1}
                        >
                          {tier.name}
                        </Text>
                        {/* A zero-price tier reads as "Free", never "0.00 HTG" —
                            an amount implies a charge that will never happen. */}
                        <Text style={styles.tierPrice} numberOfLines={1}>
                          {isFreeTier(tier)
                            ? t('common.free')
                            : formatCurrency(tier.price, displayCurrency)}
                        </Text>
                      </View>

                      {(note || tier.description) && (
                        <View style={styles.tierMetaLine}>
                          {note && (
                            <Text
                              style={[
                                styles.tierMeta,
                                isSoldOut && styles.tierMetaSoldOut,
                              ]}
                              numberOfLines={1}
                            >
                              {note}
                            </Text>
                          )}
                          {!!note && !!tier.description && (
                            <Text style={styles.tierMetaDot}>·</Text>
                          )}
                          {!!tier.description && (
                            <Text style={styles.tierMetaDescription} numberOfLines={1}>
                              {tier.description}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Quantity Selector (width reserved even when hidden) */}
                    <View style={styles.stepper}>
                      {isAvailable && (
                        <>
                          <TouchableOpacity
                            onPress={() => updateTierQuantity(tier.id, -1)}
                            disabled={quantity === 0}
                            hitSlop={STEPPER_HIT_SLOP}
                            style={[
                              styles.stepperButton,
                              quantity === 0 && styles.stepperButtonDisabled,
                            ]}
                          >
                            <Minus size={16} color={quantity === 0 ? colors.textTertiary : colors.primary} />
                          </TouchableOpacity>

                          <Text style={styles.stepperCount}>{quantity}</Text>

                          <TouchableOpacity
                            onPress={() => updateTierQuantity(tier.id, 1)}
                            disabled={atMax}
                            hitSlop={STEPPER_HIT_SLOP}
                            style={[
                              styles.stepperButton,
                              atMax && styles.stepperButtonDisabled,
                            ]}
                          >
                            <Plus size={16} color={atMax ? colors.textTertiary : colors.primary} />
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                );
              })}

              {/* Promo Code — collapsed behind a quiet toggle */}
              {getTotalQuantity() > 0 && (
                <View style={styles.promoBlock}>
                  <TouchableOpacity
                    style={styles.promoToggle}
                    onPress={() => setPromoOpen(prev => !prev)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: promoExpanded }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Tag size={14} color={colors.textSecondary} />
                    <Text style={styles.promoToggleText}>{t('ticketSelector.havePromoCode')}</Text>
                    {promoExpanded ? (
                      <ChevronUp size={14} color={colors.textTertiary} />
                    ) : (
                      <ChevronDown size={14} color={colors.textTertiary} />
                    )}
                  </TouchableOpacity>

                  {promoExpanded && (
                    <>
                      <View style={styles.promoRow}>
                        <TextInput
                          style={styles.promoInput}
                          placeholder={t('ticketSelector.promoPlaceholder')}
                          placeholderTextColor={colors.textTertiary}
                          selectionColor={colors.primary}
                          value={promoCode}
                          onChangeText={(text) => {
                            setPromoCode(text);
                            // An edited code is no longer the code that validated.
                            if (promoValidation) setPromoValidation(null);
                          }}
                          autoCapitalize="characters"
                          onSubmitEditing={validatePromoCode}
                        />
                        <TouchableOpacity
                          style={styles.promoApplyButton}
                          onPress={validatePromoCode}
                          disabled={!promoCode.trim() || validatingPromo}
                        >
                          {validatingPromo ? (
                            <ActivityIndicator size="small" color={colors.text} />
                          ) : (
                            <Text
                              style={[
                                styles.promoApplyButtonText,
                                (!promoCode.trim() || validatingPromo) && styles.promoApplyButtonTextDisabled,
                              ]}
                            >
                              {t('ticketSelector.apply')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      {promoValidation && (
                        <Text
                          style={[
                            styles.promoResultText,
                            { color: promoValidation.valid ? colors.success : colors.error },
                          ]}
                        >
                          {promoValidation.valid
                            ? promoValidation.discount_percentage
                              ? `✓ ${promoValidation.discount_percentage}% ${t('ticketSelector.discountApplied')}`
                              : promoValidation.discount_amount
                                ? `✓ ${formatCurrency(promoValidation.discount_amount, displayCurrency)} ${t('ticketSelector.discountApplied')}`
                                : `✓ ${t('ticketSelector.discountApplied')}`
                            : `✗ ${promoValidation.error}`
                          }
                        </Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          </ScrollView>
        )}

        {/* Footer with Purchase Button */}
        {getTotalQuantity() > 0 && !loading && (() => {
          const totalQuantity = getTotalQuantity();
          const totalPrice = getTotalPrice();
          // A zero total must never promise a payment step: no gateway can take
          // 0, and the caller routes this order down the free-claim path instead.
          const isFreeOrder = totalPrice <= 0;
          // What the card is actually charged. In a buyer-pays market the service
          // fee is added on top, so showing the face total here and a bigger number
          // on the payment sheet would be the drip pricing the all-in rule forbids.
          // The server recomputes this; the cap is per ticket, hence the quantity.
          const orderPricing = priceOrder(
            totalPrice,
            { country, currency: displayCurrency, fee_incidence: feeIncidence },
            { quantity: totalQuantity }
          );
          const showFeeLine = orderPricing.feeOnTop && orderPricing.buyerFee > 0;
          return (
          <View style={styles.footer}>
            <View style={styles.totalContainer}>
              <View>
                <Text style={styles.totalLabel}>
                  {totalQuantity} {totalQuantity === 1 ? t('ticketSelector.ticketSingular') : t('ticketSelector.ticketPlural')}
                </Text>
                {(promoValidation?.valid) && (
                  <Text style={styles.discountLabel}>
                    {t('ticketSelector.promoApplied')}
                  </Text>
                )}
              </View>
              <View style={styles.priceContainer}>
                <Text style={styles.totalPrice}>
                  {isFreeOrder
                    ? t('common.free')
                    : formatCurrency(orderPricing.total, displayCurrency)}
                </Text>
                {showFeeLine && (
                  <Text style={styles.feeLine}>
                    {t('ticketSelector.includesFee', {
                      amount: formatCurrency(orderPricing.buyerFee, displayCurrency),
                    })}
                  </Text>
                )}
              </View>
            </View>
            {/* No subLabel: the amount lives once, in the total above. */}
            <WhitePillCTA
              variant={isFreeOrder ? 'rsvp' : 'paid'}
              label={
                isFreeOrder
                  ? t(`freeTicket.claimButton.${totalQuantity === 1 ? 'one' : 'other'}`).replace(
                      '{count}',
                      String(totalQuantity)
                    )
                  : t('ticketSelector.continueToPayment')
              }
              onPress={handlePurchase}
            />
          </View>
          );
        })()}
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  // Eyebrow + inline hint on ONE line, replacing the old stacked
  // title (16/600 + 12pt marginBottom) and subtitle rows.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  sectionHint: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.textTertiary,
  },
  // Quiet row on the black canvas, separated by a hairline — no card, no fill.
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // The promo block carries its own top hairline, so the last tier drops its
  // divider to avoid a double rule.
  tierRowLast: {
    borderBottomWidth: 0,
  },
  tierRowDisabled: {
    opacity: 0.5,
  },
  tierMain: {
    flex: 1,
    minWidth: 0,
  },
  tierTitleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  tierName: {
    // flex (not flexShrink) so the price is pushed to the trailing edge and
    // prices line up in a column down a list of 5+ tiers.
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  tierNameDisabled: {
    color: colors.textTertiary,
  },
  tierPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  tierMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  tierMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  tierMetaSoldOut: {
    color: colors.error,
  },
  tierMetaDot: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  tierMetaDescription: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.textTertiary,
  },
  // Outlined 28pt glyph buttons (44pt touch target via STEPPER_HIT_SLOP) —
  // deliberately unfilled so the row stays quiet.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    // 28 + 8 + 20 + 8 + 28 — reserved even on unavailable rows (where the
    // controls are omitted) so the price column stays aligned.
    minWidth: 92,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperCount: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginHorizontal: 8,
    minWidth: 20,
    textAlign: 'center',
  },
  promoBlock: {
    marginTop: 4,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  promoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  promoToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  promoInput: {
    flex: 1,
    height: 44,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: 12,
  },
  promoApplyButton: {
    height: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoApplyButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  promoApplyButtonTextDisabled: {
    color: colors.textTertiary,
  },
  promoResultText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  totalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  discountLabel: {
    fontSize: 12,
    color: colors.success,
    marginTop: 2,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  totalPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  // The fee that makes up the difference between the tier prices above and the
  // total — quiet, but present before the buyer commits.
  feeLine: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
  },
});
