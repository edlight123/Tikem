import React, { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, X } from 'lucide-react-native';
import { auth } from '../../config/firebase';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { PhoneCodeFlow } from './PhoneCodeFlow';
import { AuthInput } from './AuthInput';
import WhitePillCTA from '../WhitePillCTA';
import { PhoneAuthError, requestLinkCode, verifyLinkCode } from '../../lib/phoneAuth';
import { prettyPhone } from '../../lib/phoneAuthGate';
import { accountErrorKey, commitMerge } from '../../lib/accountLink';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLinked?: (phoneNumber: string) => void;
  /** Overrides for the "add your number" prompt (PhonePromptHost). */
  title?: string;
  subtitle?: string;
  /** Shows a quiet "Not now" under the flow; closing the sheet does the same. */
  skipLabel?: string;
}

type Step = 'flow' | 'done' | 'merge' | 'reauth' | 'support';

/**
 * Profile > "Add phone number" (behind the phone-auth flag). Verifies the
 * number with a WhatsApp code, then the server adds it to the signed-in
 * account, so next time the person can sign in with it.
 *
 * If the number already has its own Tikèm account (someone who signed in with
 * their phone before), the code just proved it is theirs: offer to combine
 * that account INTO this one (lib/auth/account/merge.ts). The merge asks for a
 * fresh sign-in on this account first (password, Google or Apple).
 */
export default function PhoneLinkSheet({ visible, onClose, onLinked, title, subtitle, skipLabel }: Props) {
  const { t, language } = useI18n();
  const { refreshUserProfile, reauthMethod, reauthenticate } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>('flow');
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setStep('flow');
    setMergeId(null);
    setError(null);
    setPassword('');
    onClose();
  };

  const linked = async (number: string) => {
    // Pick up the new phoneNumber on the Firebase user and the profile.
    await auth.currentUser?.reload().catch(() => {});
    await refreshUserProfile();
    setStep('done');
    onLinked?.(number);
  };

  const combine = async () => {
    if (!mergeId) return;
    setBusy(true);
    setError(null);
    try {
      await commitMerge(mergeId);
      await linked(phone);
    } catch (err: any) {
      if (err?.code === 'reauth_required') setStep('reauth');
      else if (err?.code === 'organizer_merge_needs_review') setStep('support');
      else setError(t(accountErrorKey(err?.code)));
    } finally {
      setBusy(false);
    }
  };

  const method = reauthMethod();
  const confirmIdentity = async () => {
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(method === 'password' ? password : undefined);
    } catch (err: any) {
      setBusy(false);
      if (err?.code !== 'auth/cancelled' && err?.code !== 'ERR_REQUEST_CANCELED') {
        setError(t('auth.errors.invalidCredential'));
      }
      return;
    }
    setBusy(false);
    setPassword('');
    setStep('merge');
    await combine();
  };

  let body: React.ReactNode;
  if (step === 'done') {
    body = <Text style={styles.sub}>{mergeId ? t('account.merge.done') : t('auth.phone.link.success')}</Text>;
  } else if (step === 'merge') {
    body = (
      <>
        <Text style={styles.sub}>{t('account.merge.bodyPhone', { phone: prettyPhone(phone) })}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <WhitePillCTA label={t('account.merge.cta')} onPress={combine} loading={busy} size="sm" />
        <Pressable onPress={close} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.skip}>
          <Text style={styles.skipText}>{t('account.merge.notNow')}</Text>
        </Pressable>
      </>
    );
  } else if (step === 'reauth') {
    body = (
      <>
        <Text style={styles.sub}>{t('account.merge.confirmTitle')}</Text>
        {method === 'password' ? (
          <AuthInput
            icon={Lock}
            isPassword
            placeholder={t('account.merge.confirmPassword')}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={confirmIdentity}
            editable={!busy}
          />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {method ? (
          <WhitePillCTA
            label={
              method === 'google'
                ? t('account.merge.confirmGoogle')
                : method === 'apple'
                  ? t('account.merge.confirmApple')
                  : t('account.merge.confirmCta')
            }
            onPress={confirmIdentity}
            loading={busy}
            size="sm"
          />
        ) : (
          <Text style={styles.error}>{t('account.errors.generic')}</Text>
        )}
      </>
    );
  } else if (step === 'support') {
    body = (
      <>
        <Text style={styles.sub}>{t('account.support.title')}</Text>
        <WhitePillCTA
          label={t('account.support.cta')}
          onPress={() =>
            Linking.openURL(`mailto:support@tikem.co?subject=${encodeURIComponent(t('account.support.subject'))}`).catch(() => {})
          }
          size="sm"
        />
      </>
    );
  } else {
    body = (
      <>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        <PhoneCodeFlow
          ctaLabel={t('auth.phone.link.cta')}
          onBusyChange={setBusy}
          onRequestCode={(p, iso) => requestLinkCode(p, iso, language)}
          onVerify={async (p, iso, code) => {
            try {
              const number = await verifyLinkCode(p, iso, code);
              await linked(number);
            } catch (err) {
              // The number has its own account: the code proved it is theirs.
              const offer = err instanceof PhoneAuthError && err.code === 'phone_in_use' ? err.payload : null;
              if (offer?.mergeStatus === 'merge_available' && offer.mergeId) {
                setPhone(p);
                setMergeId(offer.mergeId);
                setStep('merge');
                return;
              }
              if (offer?.mergeStatus === 'needs_review') {
                setStep('support');
                return;
              }
              throw err;
            }
          }}
        />
        {skipLabel ? (
          <Pressable onPress={close} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.skip}>
            <Text style={styles.skipText}>{skipLabel}</Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  const heading =
    step === 'merge' ? t('account.merge.title') : step === 'reauth' ? t('account.merge.confirmTitle') : title ?? t('auth.phone.link.title');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{heading}</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('auth.phone.link.close')}>
              <X size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {body}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  avoid: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...type.title,
    color: colors.textPrimary,
    flex: 1,
  },
  sub: {
    ...type.body,
    color: colors.textSecondary,
  },
  error: { color: colors.red, fontSize: 13 },
  skip: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: {
    ...type.label,
    color: colors.textSecondary,
  },
});
