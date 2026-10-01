import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS, SPACING } from '../../config/brand';
import { colors as T } from '../../theme/tokens';
import { countryName, countrySupport } from '../../lib/countrySupport';
import { DECLARABLE_MARKETS, railsForMarkets } from '../../lib/organizerMarkets';
import WhitePillCTA from '../WhitePillCTA';

interface MarketsSheetProps {
  visible: boolean;
  /** The saved answer — the sheet edits a DRAFT of it until Save. */
  markets: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (next: string[]) => void;
}

/**
 * A simple colour-square flag: a few flat bands, no artwork. Enough to find
 * your country at a glance without importing flag images.
 */
export function FlagSquare({ code, size = 24 }: { code: string; size?: number }) {
  const box = { width: size, height: size, borderRadius: 5, overflow: 'hidden' as const };
  const col = (c: string) => ({ flex: 1, backgroundColor: c });
  switch (code) {
    case 'HT':
      return (
        <View style={box}>
          <View style={col('#00209F')} />
          <View style={col('#D21034')} />
        </View>
      );
    case 'US':
      return (
        <View style={box}>
          {['#B22234', '#FFFFFF', '#B22234', '#FFFFFF', '#B22234'].map((c, i) => (
            <View key={i} style={col(c)} />
          ))}
          <View style={{ position: 'absolute', top: 0, left: 0, width: size * 0.45, height: size * 0.5, backgroundColor: '#3C3B6E' }} />
        </View>
      );
    case 'CA':
      return (
        <View style={[box, { flexDirection: 'row' }]}>
          <View style={col('#D80621')} />
          <View style={[col('#FFFFFF'), { flex: 2, alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ width: size * 0.28, height: size * 0.28, backgroundColor: '#D80621', transform: [{ rotate: '45deg' }] }} />
          </View>
          <View style={col('#D80621')} />
        </View>
      );
    case 'FR':
      return (
        <View style={[box, { flexDirection: 'row' }]}>
          <View style={col('#002395')} />
          <View style={col('#FFFFFF')} />
          <View style={col('#ED2939')} />
        </View>
      );
    case 'DO':
      return (
        <View style={box}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={col('#002D62')} />
            <View style={col('#CE1126')} />
          </View>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={col('#CE1126')} />
            <View style={col('#002D62')} />
          </View>
        </View>
      );
    default:
      return <View style={[box, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />;
  }
}

interface MarketsPickerProps {
  /** The countries currently picked (a draft until the caller saves it). */
  draft: string[];
  onToggle: (code: string) => void;
  disabled?: boolean;
  /**
   * Rows on the bare canvas (the payout setup step) use `surface`; inside the
   * sheet, which is itself `surface`, they step up to `surfaceRaised`.
   */
  onCanvas?: boolean;
  /** Show the "how many setups" hint under the rows. */
  showHint?: boolean;
}

/**
 * The country rows: flag, name, how that country pays out, and a teal check
 * when picked. Shared by MarketsSheet (Change, from the payout summary) and
 * step 2 of the payout setup, so the question reads the same wherever it is
 * asked.
 */
export function MarketsPicker({ draft, onToggle, disabled = false, onCanvas = false, showHint = true }: MarketsPickerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();

  const rails = railsForMarkets(draft);
  const hint =
    draft.length === 0
      ? t('organizerPayoutSettings.markets.noneHint')
      : rails.length > 1
        ? t('organizerPayoutSettings.markets.twoSetupsHint')
        : t('organizerPayoutSettings.markets.oneSetupHint');

  const railLabel = (code: string) => {
    const rail = countrySupport(code)?.requiredProfile;
    if (rail === 'haiti') return t('organizerPayoutSettings.markets.railHaiti');
    if (rail === 'stripe_connect') return t('organizerPayoutSettings.markets.railStripe');
    return '';
  };

  return (
    <View>
      {DECLARABLE_MARKETS.map((code) => {
        const on = draft.includes(code);
        const sub = railLabel(code);
        return (
          <TouchableOpacity
            key={code}
            style={[styles.row, onCanvas && styles.rowCanvas, on && styles.rowOn]}
            onPress={() => onToggle(code)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <FlagSquare code={code} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{countryName(code)}</Text>
              {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
            </View>
            <View style={styles.checkSlot}>
              {on ? <Check size={20} color={T.teal} strokeWidth={2.5} /> : null}
            </View>
          </TouchableOpacity>
        );
      })}
      {showHint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * "Where you run events", as something you open, edit and save — never a rack
 * of countries laid out on the payout page. Toggling a row only changes the
 * draft; nothing is written until Save, and closing the sheet discards it.
 */
export default function MarketsSheet({ visible, markets, saving, onClose, onSave }: MarketsSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string[]>(markets);

  // Every open starts from the saved answer, so a cancelled edit never leaks
  // into the next one.
  useEffect(() => {
    if (visible) setDraft(markets);
  }, [visible, markets]);

  const toggle = (code: string) =>
    setDraft((d) => (d.includes(code) ? d.filter((c) => c !== code) : [...d, code]));

  const dirty =
    draft.length !== markets.length || draft.some((code) => !markets.includes(code));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('organizerPayoutSettings.markets.title')}</Text>
              <Text style={styles.subtitle}>{t('organizerPayoutSettings.markets.subtitle')}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            <MarketsPicker draft={draft} onToggle={toggle} disabled={saving} />
          </ScrollView>

          <WhitePillCTA
            label={t('organizerPayoutSettings.markets.save')}
            onPress={() => onSave(draft)}
            loading={saving}
            disabled={saving || !dirty}
          />
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SPACING.lg,
      paddingTop: 10,
      maxHeight: '85%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 18,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      marginTop: 4,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: {
      flexGrow: 0,
    },
    // Fill, not a hairline: rows are surfaces; a picked row gets a brighter
    // fill and the teal check, never a ring around an empty box.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: RADIUS.md,
      backgroundColor: colors.surfaceRaised,
      marginBottom: 8,
    },
    rowCanvas: {
      backgroundColor: colors.surface,
    },
    rowOn: {
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    rowSub: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    checkSlot: {
      width: 24,
      alignItems: 'center',
    },
    hint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
      marginTop: 6,
      marginBottom: 16,
    },
  });
