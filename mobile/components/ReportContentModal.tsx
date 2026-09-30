import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Check } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { radius, spacing } from '../theme/tokens';

/** Mirrors REPORT_REASONS in lib/moderation/reports.ts — anything else is rejected. */
export const REPORT_REASONS = [
  'spam',
  'scam_or_fraud',
  'offensive',
  'violence',
  'sexual',
  'illegal',
  'misleading',
  'other',
] as const;
type Reason = (typeof REPORT_REASONS)[number];

const MAX_DETAILS = 1000;
const KNOWN_ERRORS = ['rate_limited', 'unauthorized', 'not_found', 'self_report'];

interface ReportContentModalProps {
  visible: boolean;
  onClose: () => void;
  kind: 'event' | 'organizer';
  targetId: string;
}

/**
 * "Report event" / "Report organizer" (App Store guideline 1.2): a reason, an
 * optional note, and a POST to the moderation route. Errors are localized from
 * the server's `code`, never shown as its English string.
 */
export default function ReportContentModal({ visible, onClose, kind, targetId }: ReportContentModalProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'sent' | 'duplicate' | null>(null);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetails('');
      setError('');
      setDone(null);
      setLoading(false);
    }
  }, [visible]);

  const canSend = !!reason && !loading;

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    setError('');
    try {
      const path =
        kind === 'event'
          ? `/api/events/${encodeURIComponent(targetId)}/report`
          : `/api/organizers/${encodeURIComponent(targetId)}/report`;
      const res = await backendJson<{ duplicate?: boolean }>(path, {
        method: 'POST',
        body: JSON.stringify({ reason, details: details.trim() || undefined }),
      });
      setDone(res?.duplicate ? 'duplicate' : 'sent');
    } catch (e: any) {
      const code = String(e?.code || '');
      setError(t(`moderation.errors.${KNOWN_ERRORS.includes(code) ? code : 'generic'}`));
    } finally {
      setLoading(false);
    }
  };

  const title = done
    ? t('moderation.successTitle')
    : kind === 'event'
      ? t('moderation.reportEventTitle')
      : t('moderation.reportOrganizerTitle');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {done ? (
              <View style={styles.doneBody}>
                <Text style={styles.body}>
                  {done === 'duplicate' ? t('moderation.alreadyReported') : t('moderation.successBody')}
                </Text>
                <TouchableOpacity style={styles.submit} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.submitText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.intro}>{t('moderation.reportIntro')}</Text>
                {REPORT_REASONS.map((key) => {
                  const selected = reason === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.reasonRow}
                      onPress={() => setReason(key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.reasonLabel}>{t(`moderation.reasons.${key}`)}</Text>
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <Check size={13} color={colors.background} /> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <TextInput
                  style={styles.input}
                  value={details}
                  onChangeText={(v) => setDetails(v.slice(0, MAX_DETAILS))}
                  placeholder={t('moderation.detailsPlaceholder')}
                  placeholderTextColor={colors.textTertiary || colors.textSecondary}
                  multiline
                  textAlignVertical="top"
                  maxLength={MAX_DETAILS}
                  editable={!loading}
                />
                <Text style={styles.counter}>
                  {details.length}/{MAX_DETAILS}
                </Text>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.submit, !canSend && styles.submitDisabled]}
                  onPress={handleSend}
                  disabled={!canSend}
                  accessibilityRole="button"
                >
                  {loading ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text style={styles.submitText}>{t('moderation.submit')}</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.contact}>{t('moderation.contactLine')}</Text>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheetWrap: { width: '100%' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl,
      maxHeight: '90%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.lg,
      marginBottom: spacing.md,
    },
    title: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text },
    intro: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: spacing.sm },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
    },
    reasonLabel: { fontSize: 16, color: colors.text },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: colors.text, borderColor: colors.text },
    input: {
      marginTop: spacing.md,
      minHeight: 96,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      padding: spacing.lg,
      fontSize: 16,
      color: colors.text,
    },
    counter: { alignSelf: 'flex-end', marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary },
    error: { marginTop: spacing.md, fontSize: 14, color: colors.error },
    submit: {
      marginTop: spacing.xl,
      height: 56,
      borderRadius: radius.button,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitDisabled: { opacity: 0.4 },
    submitText: { fontSize: 16, fontWeight: '700', color: colors.background },
    contact: { marginTop: spacing.md, textAlign: 'center', fontSize: 12, color: colors.textSecondary },
    doneBody: { paddingBottom: spacing.md },
    body: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
  });
