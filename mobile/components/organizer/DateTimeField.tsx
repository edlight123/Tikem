/**
 * DateTimeField — one date-and-time value, picked with the platform's own
 * picker inside a clean sheet. Used for the event's start and end and for an
 * add-on's sales window, so every date in the organizer flow looks and works
 * the same (rules: lib/dateTimeDefaults).
 *
 * The trigger reads "Sat, Mar 1 · 7:00 PM" in the viewer's language. The
 * sheet edits a copy: Done commits, closing discards, Clear (when allowed)
 * empties the value.
 *   - iOS: the native inline calendar with its time row (mode "datetime").
 *   - Android: a date button and a time button, each opening the native dialog.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CalendarDays, Clock, X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { localeForLanguage } from '../../lib/format';
import { clock12FromParts } from '../../lib/eventClock';
import { radius } from '../../theme/tokens';
import FormSheet from './FormSheet';
import WhitePillCTA from '../WhitePillCTA';

export function formatDateTime(d: Date, locale: string): { date: string; time: string } {
  return {
    date: d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }),
    // 12-hour everywhere (Haiti uses AM/PM; the composer always has).
    time: clock12FromParts(d.getHours(), d.getMinutes()),
  };
}

interface Props {
  label: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
  /** Sheet title (defaults to the label). */
  title?: string;
  placeholder?: string;
  minimumDate?: Date;
  /** Where the sheet starts when the value is empty. */
  initialValue?: Date;
  /** Shows "Clear" in the sheet and an × on the trigger. */
  clearable?: boolean;
  /** Small line under the trigger (helper text). */
  helper?: string;
  /** An error message, or true to only colour the row. */
  error?: string | boolean;
  /** 'row' = the composer's inline row; 'filled' = a sheet field. */
  variant?: 'row' | 'filled';
  required?: boolean;
}

export default function DateTimeField({
  label,
  value,
  onChange,
  title,
  placeholder,
  minimumDate,
  initialValue,
  clearable = false,
  helper,
  error,
  variant = 'row',
  required = false,
}: Props) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const locale = localeForLanguage(language);
  const styles = getStyles(colors);
  const [draft, setDraft] = useState<Date | null>(null);

  const open = () => {
    const base = value || initialValue || nextRoundHour();
    setDraft(minimumDate && base < minimumDate ? new Date(minimumDate) : new Date(base));
  };
  const close = () => setDraft(null);
  const done = () => {
    if (draft) onChange(draft);
    setDraft(null);
  };
  const clear = () => {
    onChange(null);
    setDraft(null);
  };

  const openAndroid = (mode: 'date' | 'time') => {
    if (!draft) return;
    DateTimePickerAndroid.open({
      value: draft,
      mode,
      is24Hour: false,
      minimumDate: mode === 'date' ? minimumDate : undefined,
      onChange: (event, picked) => {
        if (event.type !== 'set' || !picked) return;
        const next = new Date(draft);
        if (mode === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
        else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
        setDraft(next);
      },
    });
  };

  const shown = value ? formatDateTime(value, locale) : null;
  const errorText = typeof error === 'string' ? error : null;
  const hasError = !!error;
  const draftText = draft ? formatDateTime(draft, locale) : null;

  return (
    <View>
      <TouchableOpacity
        onPress={open}
        activeOpacity={0.7}
        style={[variant === 'row' ? styles.row : styles.filled, variant === 'row' && { borderBottomColor: hasError ? colors.error : colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={[label, shown ? `${shown.date} ${shown.time}` : placeholder].filter(Boolean).join(', ')}
      >
        <Text style={[styles.label, hasError && { color: colors.error }]} numberOfLines={1}>
          {label}
          {required ? ' *' : ''}
        </Text>
        <View style={styles.valueWrap}>
          {shown ? (
            <>
              <Text style={styles.value} numberOfLines={1}>
                {shown.date}
              </Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.value} numberOfLines={1}>
                {shown.time}
              </Text>
            </>
          ) : (
            <Text style={styles.placeholder} numberOfLines={1}>
              {placeholder || t('dateTimeField.pick')}
            </Text>
          )}
        </View>
        {clearable && value ? (
          <TouchableOpacity
            onPress={clear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('dateTimeField.clear')}
            style={styles.clearX}
          >
            <X size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      {errorText ? <Text style={styles.error}>{errorText}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}

      <FormSheet
        visible={draft !== null}
        title={title || label}
        onClose={close}
        closeLabel={t('a11y.close')}
        footer={
          <View style={{ gap: 12 }}>
            <WhitePillCTA label={t('dateTimeField.done')} onPress={done} />
            {clearable && value ? (
              <TouchableOpacity onPress={clear} style={styles.clearLink} accessibilityRole="button">
                <Text style={styles.clearText}>{t('dateTimeField.clear')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      >
        {draft ? (
          Platform.OS === 'ios' ? (
            <View style={styles.iosWrap}>
              <DateTimePicker
                value={draft}
                mode="datetime"
                display="inline"
                onChange={(_e, d) => d && setDraft(d)}
                minimumDate={minimumDate}
                accentColor={colors.primary}
                themeVariant="light"
                locale={locale}
              />
            </View>
          ) : (
            <View style={styles.androidRow}>
              <TouchableOpacity style={styles.androidBtn} onPress={() => openAndroid('date')} accessibilityRole="button">
                <CalendarDays size={18} color={colors.textSecondary} />
                <Text style={styles.androidText}>{draftText?.date}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.androidBtn} onPress={() => openAndroid('time')} accessibilityRole="button">
                <Clock size={18} color={colors.textSecondary} />
                <Text style={styles.androidText}>{draftText?.time}</Text>
              </TouchableOpacity>
            </View>
          )
        ) : null}
      </FormSheet>
    </View>
  );
}

/** The next whole hour from now: where an empty picker starts. */
function nextRoundHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 10,
    },
    filled: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised ?? colors.background,
      gap: 10,
      marginBottom: 4,
    },
    label: { fontSize: 15, color: colors.textSecondary, minWidth: 64 },
    valueWrap: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
    value: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
    dot: { fontSize: 15, color: colors.textTertiary },
    placeholder: { fontSize: 15, color: colors.textTertiary },
    clearX: { padding: 2 },
    helper: { fontSize: 12, color: colors.textTertiary, marginTop: 4, marginBottom: 6 },
    error: { fontSize: 13, color: colors.error, marginTop: 4, marginBottom: 6 },
    iosWrap: { alignItems: 'center', paddingBottom: 8 },
    androidRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
    androidBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised ?? colors.background,
    },
    androidText: { fontSize: 16, fontWeight: '600', color: colors.text },
    clearLink: { alignItems: 'center', paddingVertical: 4 },
    clearText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  });
