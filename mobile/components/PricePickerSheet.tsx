import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { RADIUS, SPACING } from '../config/brand';
import { formatPrice } from '../lib/currency';
import RangeSlider from './RangeSlider';

export interface PriceRange {
  min: number;
  /** Open-ended when >= the ceiling for the currency. */
  max: number;
}

interface PricePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** ISO currency code driving the ceiling/step (HTG/DOP are high-denomination). */
  currencyCode: string;
  /** Current range, or null for "any price". */
  value: PriceRange | null;
  /** Apply with a range, or null to clear back to "any price". */
  onApply: (range: PriceRange | null) => void;
}

/**
 * Bottom-sheet budget picker — the dual-thumb slider from the Discover filters
 * as its own sheet, for the category page's Price chip (posh's pattern). Same
 * ceiling/step rules as EventFiltersSheet so "under 500" means the same thing
 * everywhere.
 */
export default function PricePickerSheet({
  visible,
  onClose,
  currencyCode,
  value,
  onApply,
}: PricePickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const isHighDenomination = currencyCode === 'HTG' || currencyCode === 'DOP';
  const ceiling = isHighDenomination ? 10000 : 200;
  const step = isHighDenomination ? 100 : 5;

  const [low, setLow] = useState(value?.min ?? 0);
  const [high, setHigh] = useState(value?.max ?? ceiling);

  // Re-seed from the applied value each time the sheet opens, so Cancel
  // (backdrop tap) discards any half-dragged state.
  useEffect(() => {
    if (visible) {
      setLow(value?.min ?? 0);
      setHigh(value?.max ?? ceiling);
    }
  }, [visible, value, ceiling]);

  const openEnded = high >= ceiling;
  const readout =
    `${formatPrice(low, currencyCode)} – ` +
    (openEnded ? `${formatPrice(ceiling, currencyCode)}+` : formatPrice(high, currencyCode));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('filters.priceRange')}</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        <Text style={styles.readout}>{readout}</Text>
        <View style={styles.sliderWrap}>
          <RangeSlider
            min={0}
            max={ceiling}
            step={step}
            low={low}
            high={high}
            onChange={(l, h) => {
              setLow(l);
              setHigh(h);
            }}
            colors={colors}
          />
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={() => {
              onApply(null);
              onClose();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.resetText}>{t('filters.reset')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => {
              // Full range selected = no constraint; store null so the chip
              // reads as inactive rather than "0 – 10,000+".
              onApply(low === 0 && openEnded ? null : { min: low, max: high });
              onClose();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.applyText}>{t('filters.apply')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SPACING.lg,
      paddingTop: 10,
      borderTopWidth: 1,
      borderColor: colors.border,
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
      marginBottom: 6,
    },
    title: { fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    readout: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 14,
    },
    sliderWrap: {
      marginBottom: 20,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
    },
    resetBtn: {
      flex: 1,
      height: 48,
      borderRadius: RADIUS.md,
      // A quiet fill, not an outline around nothing.
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resetText: { fontSize: 15, fontWeight: '600', color: colors.text },
    applyBtn: {
      flex: 2,
      height: 48,
      borderRadius: RADIUS.md,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applyText: { fontSize: 15, fontWeight: '700', color: '#0A0A0A' },
  });
