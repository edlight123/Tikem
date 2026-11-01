import React, { useState } from 'react';
import { View, Text, Modal, Platform, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { RADIUS, SPACING } from '../config/brand';
import type { DateFilter } from './DateChips';

interface WhenPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  value: DateFilter;
  /** `pickedDate` (YYYY-MM-DD) accompanies value === 'pick-date'. */
  onSelect: (value: DateFilter, pickedDate?: string) => void;
}

const DATE_OPTIONS: { value: DateFilter; labelKey: string }[] = [
  { value: 'any', labelKey: 'filters.dateOptions.any' },
  { value: 'today', labelKey: 'filters.dateOptions.today' },
  { value: 'tomorrow', labelKey: 'filters.dateOptions.tomorrow' },
  { value: 'this-week', labelKey: 'filters.dateOptions.thisWeek' },
  { value: 'this-weekend', labelKey: 'filters.dateOptions.thisWeekend' },
];

/** Bottom-sheet "When" picker — mirrors the location sheet styling. */
export default function WhenPickerSheet({ visible, onClose, value, onSelect }: WhenPickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  // Expands the row into an inline calendar rather than opening a second
  // modal — posh's "Choose Date" is a month view inside the same sheet.
  const [showCalendar, setShowCalendar] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('discover.when')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        {DATE_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.row, active && styles.rowActive]}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.rowText, active && styles.rowTextActive]}>
                {t(option.labelKey)}
              </Text>
              {active && <Check size={18} color={colors.background} />}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.row, value === 'pick-date' && styles.rowActive]}
          onPress={() => setShowCalendar((v) => !v)}
          activeOpacity={0.8}
        >
          <Text style={[styles.rowText, value === 'pick-date' && styles.rowTextActive]}>
            {t('filters.dateOptions.pickDate')}
          </Text>
          {value === 'pick-date' && <Check size={18} color={colors.background} />}
        </TouchableOpacity>

        {showCalendar && (
          <DateTimePicker
            value={new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
            minimumDate={new Date()}
            themeVariant="dark"
            accentColor={colors.primary}
            onChange={(event, date) => {
              if (event.type === 'dismissed' || !date) {
                setShowCalendar(false);
                return;
              }
              const y = date.getFullYear();
              const m = String(date.getMonth() + 1).padStart(2, '0');
              const d = String(date.getDate()).padStart(2, '0');
              onSelect('pick-date', `${y}-${m}-${d}`);
              setShowCalendar(false);
              onClose();
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
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
      marginBottom: 14,
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
      paddingHorizontal: 14,
      borderRadius: RADIUS.md,
      marginBottom: 8,
      backgroundColor: colors.surfaceMuted,
    },
    // Selection is fill against fill, as on the website's chips: white with
    // black ink, never a teal outline around a tinted box (TestFlight: "what
    // did we say about this fill?").
    rowActive: { backgroundColor: colors.white },
    rowText: { fontSize: 15, fontWeight: '600', color: colors.text },
    rowTextActive: { color: colors.background, fontWeight: '700' },
  });
