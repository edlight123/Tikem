// "Request to join" sheet for approval-list events, and the plus-one fields it
// shares with the free-claim sheet. Built to Stitch screen
// 83599c799500480c9d85c6380f67e656 (project 7258845792079223737): serif title,
// a plus-one stepper, filled fields (no hairlines), a note with a counter and
// one white primary action. Spec: docs/specs/approval-lists-and-plus-ones.md.

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Minus, Plus, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../contexts/I18nContext';
import { colors as T, font, radius, spacing } from '../theme/tokens';
import WhitePillCTA from './WhitePillCTA';
import {
  ATTEND_NOTE_MAX,
  PLUS_ONE_NAME_MAX,
  attendErrorKey,
  sendAttendRequest,
  type OwnAttendRequest,
  type PlusOneInput,
} from '../lib/attendRequests';

export interface PlusOneDraft {
  firstName: string;
  phone: string;
}

export const emptyPlusOne = (): PlusOneDraft => ({ firstName: '', phone: '' });

/** Resize a plus-one list to `count`, keeping what was typed. */
export function resizePlusOnes(list: PlusOneDraft[], count: number): PlusOneDraft[] {
  const next = list.slice(0, count);
  while (next.length < count) next.push(emptyPlusOne());
  return next;
}

/** The plus-ones to send: trimmed, phone dropped when blank. */
export function plusOnesPayload(list: PlusOneDraft[]): PlusOneInput[] {
  return list.map((p) => ({
    firstName: p.firstName.trim(),
    ...(p.phone.trim() ? { phone: p.phone.trim() } : {}),
  }));
}

/** First name (required) + phone (optional) for each plus-one. */
export function PlusOneFields({
  value,
  onChange,
  editable = true,
}: {
  value: PlusOneDraft[];
  onChange: (next: PlusOneDraft[]) => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<PlusOneDraft>) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <View>
      {value.map((p, i) => (
        <View key={i} style={styles.guestGroup}>
          {value.length > 1 && <Text style={styles.guestLabel}>{t('attendRequests.sheet.guestLabel', { n: i + 1 })}</Text>}
          <Text style={styles.fieldLabel}>{t('attendRequests.sheet.firstName')}</Text>
          <TextInput
            style={styles.input}
            value={p.firstName}
            onChangeText={(text) => set(i, { firstName: text })}
            placeholder={t('attendRequests.sheet.firstNamePlaceholder')}
            placeholderTextColor={T.textTertiary}
            selectionColor={T.teal}
            maxLength={PLUS_ONE_NAME_MAX}
            autoCapitalize="words"
            autoCorrect={false}
            editable={editable}
            textContentType="givenName"
          />
          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>{t('attendRequests.sheet.phone')}</Text>
          <TextInput
            style={styles.input}
            value={p.phone}
            onChangeText={(text) => set(i, { phone: text })}
            placeholder={t('attendRequests.sheet.phonePlaceholder')}
            placeholderTextColor={T.textTertiary}
            selectionColor={T.teal}
            keyboardType="phone-pad"
            maxLength={24}
            editable={editable}
            textContentType="none"
          />
        </View>
      ))}
    </View>
  );
}

/** − n + stepper on a filled surface; square 4px buttons. */
export function PlusOneStepper({
  count,
  max,
  onChange,
  disabled,
}: {
  count: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const canDec = !disabled && count > 0;
  const canInc = !disabled && count < max;
  const label = count === 0 ? t('attendRequests.sheet.justYou') : t('attendRequests.sheet.guestCount', { count });
  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        style={[styles.stepBtn, !canDec && styles.stepBtnOff]}
        onPress={() => canDec && onChange(count - 1)}
        disabled={!canDec}
        accessibilityRole="button"
        accessibilityLabel="-"
      >
        <Minus size={16} color={T.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.stepText}>
        {label} · {t('attendRequests.sheet.max', { max })}
      </Text>
      <TouchableOpacity
        style={[styles.stepBtn, !canInc && styles.stepBtnOff]}
        onPress={() => canInc && onChange(count + 1)}
        disabled={!canInc}
        accessibilityRole="button"
        accessibilityLabel="+"
      >
        <Plus size={16} color={T.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  /** Plus-ones this guest may name (already capped by the free limit). */
  allowedPlusOnes: number;
  /** The request landed: the parent shows the pending state. */
  onSent: (request: OwnAttendRequest) => void;
}

export default function AttendRequestSheet({ visible, onClose, eventId, allowedPlusOnes, onSent }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [plusOnes, setPlusOnes] = useState<PlusOneDraft[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setPlusOnes([]);
      setNote('');
      setError(null);
    }
  }, [visible]);

  const close = () => {
    if (!sending) onClose();
  };

  const submit = async () => {
    if (sending) return;
    if (plusOnes.some((p) => !p.firstName.trim())) {
      setError(t('attendRequests.sheet.nameRequired'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await sendAttendRequest(eventId, { plusOnes: plusOnesPayload(plusOnes), note: note.trim() });
      setSending(false);
      // The parent closes this sheet before it shows anything else (two RN
      // modals do not stack on iOS).
      onSent(res.request);
    } catch (err: any) {
      setError(t(`attendRequests.errors.${attendErrorKey(err?.code)}`));
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={t('attendRequests.sheet.close')} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}>
          {/* Paints below the sheet edge so the event page never shows through. */}
          <View pointerEvents="none" style={styles.bottomFill} />
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('attendRequests.sheet.title')}</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('attendRequests.sheet.close')}>
                <X size={22} color={T.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitle}>{t('attendRequests.sheet.subtitle')}</Text>

            {allowedPlusOnes > 0 && (
              <>
                <View style={styles.eyebrowRow}>
                  <Text style={styles.eyebrow}>{t('attendRequests.sheet.bringing')}</Text>
                  <PlusOneStepper
                    count={plusOnes.length}
                    max={allowedPlusOnes}
                    onChange={(n) => setPlusOnes((prev) => resizePlusOnes(prev, n))}
                    disabled={sending}
                  />
                </View>
                <PlusOneFields value={plusOnes} onChange={setPlusOnes} editable={!sending} />
              </>
            )}

            <View style={[styles.eyebrowRow, { marginTop: spacing.xl }]}>
              <Text style={styles.eyebrow}>{t('attendRequests.sheet.note')}</Text>
              <Text style={styles.counter}>
                {t('attendRequests.sheet.noteCount', { count: note.length, max: ATTEND_NOTE_MAX })}
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={note}
              onChangeText={setNote}
              placeholder={t('attendRequests.sheet.notePlaceholder')}
              placeholderTextColor={T.textTertiary}
              selectionColor={T.teal}
              maxLength={ATTEND_NOTE_MAX}
              multiline
              textAlignVertical="top"
              editable={!sending}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <WhitePillCTA
              label={t('attendRequests.sheet.send')}
              onPress={submit}
              loading={sending}
              style={{ marginTop: spacing.xl }}
            />
            <Text style={styles.footnote}>{t('attendRequests.sheet.footnote')}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    maxHeight: '90%',
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
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: T.surfaceRaised,
    marginBottom: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: font.serif,
    fontSize: 32,
    lineHeight: 38,
    color: T.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: T.textSecondary,
    marginTop: spacing.xs,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: T.textSecondary,
    flexShrink: 1,
  },
  counter: {
    fontSize: 12,
    color: T.textTertiary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: T.surface,
    borderRadius: radius.sm,
    padding: 6,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: {
    opacity: 0.35,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: T.textPrimary,
  },
  guestGroup: {
    marginBottom: spacing.md,
  },
  guestLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: T.textSecondary,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 13,
    color: T.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: T.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    // 16pt keeps iOS from zooming on focus and matches the app's fields.
    fontSize: 16,
    color: T.textPrimary,
  },
  textarea: {
    minHeight: 96,
    paddingTop: 14,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 13,
    color: T.red,
  },
  footnote: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
    fontSize: 12,
    color: T.textTertiary,
  },
});
