/**
 * "Pass the service fee to buyers" — the composer's fee-incidence switch.
 *
 * Mirrors the web composer (app/organizer/events/EventComposer.tsx): the
 * switch reads the organizer's own choice, falling back to the country default
 * (`feeIncidenceForCountry`), and a worked example on the cheapest paid ticket
 * turns the policy into two numbers — what the buyer pays and what the
 * organizer receives — computed by the same `priceOrder` the buyer's checkout
 * uses. Display only; the server prices the real charge.
 */

import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import StatTriplet from '../StatTriplet';
import { formatPrice } from '../../lib/currency';
import { incidenceForEvent, organizerNet, priceOrder, type FeeIncidence } from '../../lib/buyerPricing';
import { radius } from '../../theme/tokens';

interface Props {
  country: string | null | undefined;
  currency: string;
  /** The organizer's explicit choice; '' / undefined = follow the country. */
  feeIncidence: FeeIncidence | '' | undefined;
  /** The paid tier prices (major units) — the example uses the cheapest. */
  paidPrices: number[];
  onChange: (incidence: FeeIncidence) => void;
}

export default function FeeIncidenceCard({ country, currency, feeIncidence, paidPrices, onChange }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const event = { country, currency, fee_incidence: feeIncidence || null };
  const passToBuyer = incidenceForEvent(event) === 'buyer';

  const price = paidPrices.length ? Math.min(...paidPrices) : 0;
  const buyerPays = price > 0 ? priceOrder(price, event, { quantity: 1 }).total : 0;
  const youReceive = price > 0 ? organizerNet(price, event, { quantity: 1 }) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={styles.title}>{t('organizerCreateEventFlow.canvas.fee.passTitle')}</Text>
          <Text style={styles.hint}>
            {passToBuyer
              ? t('organizerCreateEventFlow.canvas.fee.onDesc')
              : t('organizerCreateEventFlow.canvas.fee.offDesc')}
          </Text>
        </View>
        <Switch
          value={passToBuyer}
          onValueChange={(v) => onChange(v ? 'buyer' : 'organizer')}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.white}
          ios_backgroundColor={colors.border}
          accessibilityLabel={t('organizerCreateEventFlow.canvas.fee.passTitle')}
        />
      </View>

      {price > 0 && (
        <View style={styles.example}>
          <Text style={styles.exampleCaption}>
            {t('organizerCreateEventFlow.canvas.fee.onA', { price: formatPrice(price, currency) })}
          </Text>
          <StatTriplet
            columns={2}
            items={[
              { label: t('organizerCreateEventFlow.canvas.fee.buyerPays'), value: formatPrice(buyerPays, currency) },
              { label: t('organizerCreateEventFlow.canvas.fee.youReceive'), value: formatPrice(youReceive, currency) },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    // A filled surface, not a hairline box (POSH "a fill, not a hairline").
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginTop: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    textCol: {
      flex: 1,
      gap: 4,
    },
    title: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    // The worked example sits one brightness step up, inset in the card.
    example: {
      marginTop: 14,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 4,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    exampleCaption: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 4,
    },
  });
