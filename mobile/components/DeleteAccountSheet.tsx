import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { RADIUS, SPACING } from '../config/brand';
import { formatPrice } from '../lib/currency';
import { requestAccountDeletion, type AccountObligation } from '../lib/api/account';

const CONFIRM_WORD = 'DELETE';
const SUPPORT_EMAIL = 'support@tikem.co';

type Step = 'confirm' | 'reauth' | 'blocked';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Account deletion (App Store 5.1.1(v)). Three steps in one sheet:
 *   confirm — what goes, what stays anonymized; type DELETE
 *   reauth  — only if the server answers `reauth_required` (sign-in older than
 *             10 minutes): password, or re-run the Google/Apple sheet
 *   blocked — `organizer_has_active_obligations`, with what to resolve
 * On success the session is signed out and the navigator drops to Auth.
 */
export default function DeleteAccountSheet({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { reauthMethod, reauthenticate, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const [step, setStep] = useState<Step>('confirm');
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [obligations, setObligations] = useState<AccountObligation[]>([]);

  useEffect(() => {
    if (visible) {
      setStep('confirm');
      setTyped('');
      setPassword('');
      setError(null);
      setObligations([]);
    }
  }, [visible]);

  const method = reauthMethod();
  const providerName = method === 'apple' ? 'Apple' : method === 'google' ? 'Google' : '';

  const attemptDelete = async () => {
    setBusy(true);
    setError(null);
    const result = await requestAccountDeletion();
    if (result.ok) {
      setBusy(false);
      onClose();
      await signOut().catch(() => undefined);
      return;
    }
    setBusy(false);
    if (result.code === 'reauth_required') {
      setStep('reauth');
    } else if (result.code === 'organizer_has_active_obligations') {
      setObligations(result.obligations);
      setStep('blocked');
    } else {
      setError(t('profile.deleteAccount.failed'));
    }
  };

  const handleReauth = async () => {
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(method === 'password' ? password : undefined);
    } catch (e: any) {
      setBusy(false);
      if (e?.code === 'auth/cancelled' || e?.code === 'ERR_REQUEST_CANCELED') return;
      setError(t('profile.deleteAccount.reauthFailed'));
      return;
    }
    await attemptDelete();
  };

  const amounts = (balances: Array<{ currency: string; amountMinor: number }>) =>
    balances.map((b) => formatPrice(b.amountMinor / 100, b.currency)).join(', ');

  const renderObligation = (o: AccountObligation, i: number) => {
    switch (o.type) {
      case 'upcoming_events_with_sales':
        return (
          <View key={i} style={styles.obligation}>
            <Text style={styles.body}>{t('profile.deleteAccount.obligationEvents')}</Text>
            {o.events.map((e) => (
              <Text key={e.id} style={styles.obligationDetail}>
                {t('profile.deleteAccount.obligationEvent', { title: e.title, count: e.ticketsSold })}
              </Text>
            ))}
          </View>
        );
      case 'unwithdrawn_balance':
        return (
          <Text key={i} style={[styles.body, styles.obligation]}>
            {t('profile.deleteAccount.obligationBalance', { amounts: amounts(o.balances) })}
          </Text>
        );
      case 'withdrawals_in_flight':
        return (
          <Text key={i} style={[styles.body, styles.obligation]}>
            {t('profile.deleteAccount.obligationWithdrawals', { count: o.count })}
          </Text>
        );
      case 'promoter_wallet_balance':
        return (
          <Text key={i} style={[styles.body, styles.obligation]}>
            {t('profile.deleteAccount.obligationPromoter', { amounts: amounts(o.balances) })}
          </Text>
        );
      default:
        return null;
    }
  };

  const title =
    step === 'reauth'
      ? t('profile.deleteAccount.reauthTitle')
      : step === 'blocked'
        ? t('profile.deleteAccount.blockedTitle')
        : t('profile.deleteAccount.title');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoid} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('profile.deleteAccount.cancel')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {step === 'confirm' ? (
              <>
                <Text style={styles.body}>{t('profile.deleteAccount.intro')}</Text>
                <Text style={styles.label}>{t('profile.deleteAccount.deletedHeading')}</Text>
                <Text style={styles.body}>{t('profile.deleteAccount.deletedBody')}</Text>
                <Text style={styles.label}>{t('profile.deleteAccount.keptHeading')}</Text>
                <Text style={styles.body}>{t('profile.deleteAccount.keptBody')}</Text>
                <Text style={[styles.body, styles.warning]}>{t('profile.deleteAccount.ticketsWarning')}</Text>
                <Text style={styles.label}>{t('profile.deleteAccount.typeToConfirm', { word: CONFIRM_WORD })}</Text>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={CONFIRM_WORD}
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  accessibilityLabel={t('profile.deleteAccount.typeToConfirm', { word: CONFIRM_WORD })}
                />
              </>
            ) : null}

            {step === 'reauth' ? (
              <>
                <Text style={styles.body}>
                  {method === 'password'
                    ? t('profile.deleteAccount.reauthBodyPassword')
                    : t('profile.deleteAccount.reauthBodyProvider', { provider: providerName })}
                </Text>
                {method === 'password' ? (
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    placeholder={t('profile.deleteAccount.passwordPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.input, { marginTop: 14 }]}
                  />
                ) : null}
              </>
            ) : null}

            {step === 'blocked' ? (
              <>
                <Text style={styles.body}>{t('profile.deleteAccount.blockedBody')}</Text>
                {obligations.map(renderObligation)}
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} accessibilityRole="link">
              <Text style={styles.support}>{t('profile.deleteAccount.support', { email: SUPPORT_EMAIL })}</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>
                {step === 'blocked' ? t('profile.deleteAccount.close') : t('profile.deleteAccount.cancel')}
              </Text>
            </TouchableOpacity>
            {step !== 'blocked' ? (
              <TouchableOpacity
                style={[
                  styles.destructiveBtn,
                  (busy || (step === 'confirm' && typed.trim().toUpperCase() !== CONFIRM_WORD) ||
                    (step === 'reauth' && method === 'password' && !password)) && styles.disabled,
                ]}
                disabled={
                  busy ||
                  (step === 'confirm' && typed.trim().toUpperCase() !== CONFIRM_WORD) ||
                  (step === 'reauth' && method === 'password' && !password)
                }
                onPress={step === 'confirm' ? attemptDelete : handleReauth}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.error} />
                ) : (
                  <Text style={styles.destructiveText}>
                    {step === 'confirm'
                      ? t('profile.deleteAccount.confirm')
                      : method === 'password'
                        ? t('profile.deleteAccount.continueLabel')
                        : t('profile.deleteAccount.continueWith', { provider: providerName })}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    avoid: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '88%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SPACING.lg,
      paddingTop: 10,
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
      marginBottom: 8,
    },
    title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { flexGrow: 0 },
    label: {
      marginTop: 16,
      marginBottom: 4,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textTertiary,
    },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    warning: { marginTop: 12, color: colors.text },
    input: {
      marginTop: 4,
      borderRadius: RADIUS.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surfaceMuted,
    },
    obligation: { marginTop: 12 },
    obligationDetail: { marginTop: 4, marginLeft: 10, fontSize: 14, lineHeight: 20, color: colors.text },
    error: { marginTop: 12, fontSize: 14, color: colors.error },
    support: { marginTop: 16, marginBottom: 4, fontSize: 13, color: colors.textTertiary },
    buttonRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    cancelBtn: {
      flex: 1,
      height: 48,
      borderRadius: RADIUS.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
    // Destructive, but quiet: red text on a faint red wash — never a solid red slab.
    destructiveBtn: {
      flex: 1,
      height: 48,
      borderRadius: RADIUS.md,
      backgroundColor: 'rgba(248,113,113,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    destructiveText: { fontSize: 15, fontWeight: '700', color: colors.error },
    disabled: { opacity: 0.4 },
  });
