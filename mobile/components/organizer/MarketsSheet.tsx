import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS, SPACING } from '../../config/brand';
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
            {DECLARABLE_MARKETS.map((code) => {
              const on = draft.includes(code);
              const sub = railLabel(code);
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => toggle(code)}
                  disabled={saving}
                  activeOpacity={0.8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{countryName(code)}</Text>
                    {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Check size={14} color={colors.background} strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.hint}>{hint}</Text>

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
    // Fill, not a hairline: rows are surfaces; the selected one gets a
    // brighter fill plus the teal ring, never a ring alone.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: RADIUS.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
      marginBottom: 8,
    },
    rowOn: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderColor: colors.primary,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    rowSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 6,
      backgroundColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: {
      backgroundColor: colors.primary,
    },
    hint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
      marginTop: 6,
      marginBottom: 16,
    },
  });
