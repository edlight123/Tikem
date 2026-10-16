import React from 'react';
import { Text, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useLocaleFormat, type FormatMoneyOptions } from '../lib/format';
import { splitFormattedMoney } from '../lib/currency';

interface MoneyTextProps {
  /** Amount in MINOR units (cents). Takes precedence over `amount` when set. */
  cents?: number;
  /** Amount in MAJOR units. Ignored when `cents` is provided. */
  amount?: number;
  /** Currency code — defaults to HTG. Controls symbol/placement (never `$`). */
  currency?: 'HTG' | 'USD' | 'CAD' | 'EUR';
  /** Fixed fraction digits (defaults to 2; a whole HTG amount shows none). */
  decimals?: number;
  style?: StyleProp<TextStyle>;
  /**
   * Set the currency mark ("HTG", "$", "CA$") at ~60% of the number's size.
   * For big totals, where "12,000 HTG" in one bold run reads oversized.
   */
  splitCode?: boolean;
}

/**
 * Renders a formatted currency amount as "prices-as-data" — tabular figures,
 * white by default. The sans face is deliberate: monospace is reserved for true
 * identifiers now, so only the digit alignment is kept, not the mono voice.
 * Placement is HTG/USD aware via the shared formatter, so a
 * `$` is never hardcoded: HTG → `1,234 HTG`, USD → `$1,234.56`.
 */
export default function MoneyText({
  cents,
  amount,
  currency = 'HTG',
  decimals,
  style,
  splitCode = false,
}: MoneyTextProps) {
  const { colors } = useTheme();
  const { formatMoney } = useLocaleFormat();

  const opts: FormatMoneyOptions =
    cents !== undefined
      ? { currency, cents: true, decimals }
      : { currency, decimals };
  const value = cents !== undefined ? cents : amount ?? 0;
  const text = formatMoney(value, opts);

  return (
    <Text
      style={[styles.text, { color: colors.text }, style]}
      numberOfLines={1}
      accessibilityLabel={text}
    >
      {splitCode ? renderSplit(text, style) : text}
    </Text>
  );
}

function renderSplit(text: string, style: StyleProp<TextStyle>) {
  const { prefix, amount, suffix } = splitFormattedMoney(text);
  const size = StyleSheet.flatten([styles.text, style])?.fontSize ?? 15;
  const code: TextStyle = { fontSize: Math.round(size * 0.6), fontWeight: '600', opacity: 0.75 };
  return (
    <>
      {!!prefix && <Text style={code}>{prefix}</Text>}
      {amount}
      {!!suffix && <Text style={code}>{suffix}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
});

export { MoneyText };
