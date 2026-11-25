import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ChevronLeft, Mail, User as UserIcon } from 'lucide-react-native';
import { auth, isDemoMode } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { AuthInput } from '../../components/auth/AuthInput';
import { CodeCells } from '../../components/auth/CodeCells';
import { PhoneCodeFlow } from '../../components/auth/PhoneCodeFlow';
import WhitePillCTA from '../../components/WhitePillCTA';
import { colors, spacing, type } from '../../theme/tokens';
import { defaultAvatar } from '../../lib/defaultAvatar';
import { useImageChooser } from '../../hooks/useImageChooser';
import { ProfileImageError, uploadProfileImage } from '../../lib/profileImages';
import { useAppAlert } from '../../components/AppAlert';
import { requestPhoneCode } from '../../lib/phoneAuth';
import { maskEmail, profileCompletion, splitName } from '../../lib/profileCompletion';
import {
  AccountLinkError,
  accountErrorKey,
  commitMerge,
  completeProfile,
  saveEmailForLater,
  startEmailCode,
  verifyEmailCode,
} from '../../lib/accountLink';

type Step = 'details' | 'code' | 'merge' | 'reauth' | 'support';

const SUPPORT_EMAIL = 'support@tikem.co';

/**
 * The gate a phone sign-in passes before the app (owner, 2026-11-25): first
 * and last name and an email, then the email code, with "Verify later". Also
 * opened from Profile ("Verify your email") with `route.params.mode = 'verify'`.
 *
 * When the email belongs to another Tikèm account, the code proves the person
 * owns it and the two accounts are combined into that one (server-side,
 * lib/auth/account/merge.ts); an organizer on the phone side goes to support.
 *
 * Premium quiet: one 20pt title per step, filled fields, one 40pt white pill,
 * quiet text links. No cards, no explainers.
 */
export default function CompleteProfileScreen({ navigation, route }: any) {
  const verifyOnly = route?.params?.mode === 'verify';
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const showAlert = useAppAlert();
  const chooseImage = useImageChooser();
  const { user, userProfile, refreshUserProfile, updateUserProfile, signOut, signInWithToken, signInWithPhoneCode } =
    useAuth();

  const authEmail = user?.email || null;
  const completion = profileCompletion({
    fullName: userProfile?.full_name,
    authEmail,
    pendingEmail: userProfile?.pending_email,
  });
  const askEmail = verifyOnly || !authEmail;

  const initialName = useMemo(
    () =>
      userProfile?.first_name || userProfile?.last_name
        ? { first: userProfile?.first_name || '', last: userProfile?.last_name || '' }
        : splitName(userProfile?.full_name),
    // Prefill once; typing must not be overwritten by a profile refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [first, setFirst] = useState(initialName.first);
  const [last, setLast] = useState(initialName.last);
  const [email, setEmail] = useState(userProfile?.pending_email || '');
  const [step, setStep] = useState<Step>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (step !== 'code' || now >= resendAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, resendAt, now]);

  // Opened from Profile to verify a parked address: straight to the code.
  useEffect(() => {
    if (verifyOnly && userProfile?.pending_email) sendCode(userProfile.pending_email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const describe = (err: any) => {
    const c = err instanceof AccountLinkError ? err.code : err?.code;
    if (c === 'cooldown' && err?.retryAfterSec) return t('auth.phone.errors.cooldown', { seconds: err.retryAfterSec });
    return t(accountErrorKey(c));
  };

  const finish = async () => {
    // Pick up the verified email on the Firebase user, then the profile; the
    // navigator's gate lifts by itself once both say complete.
    await auth.currentUser?.reload().catch(() => {});
    await auth.currentUser?.getIdToken(true).catch(() => {});
    await refreshUserProfile();
    if (verifyOnly && navigation.canGoBack()) navigation.goBack();
  };

  const sendCode = async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const sent = await startEmailCode(target, language);
      setEmail(target);
      setTaken(sent.taken);
      setCode('');
      setResendAt(Date.now() + (sent.resendAfterSec ?? 60) * 1000);
      setNow(Date.now());
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (err: any) {
      if (err?.code === 'cooldown') {
        // A code is already on its way: go and enter it.
        setEmail(target);
        setStep('code');
      } else {
        setError(describe(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDetails = async () => {
    const f = first.trim();
    const l = last.trim();
    const e = email.trim().toLowerCase();
    if (!f || !l) return setError(t('account.complete.nameRequired'));
    if (askEmail && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) return setError(t('account.complete.emailRequired'));
    setBusy(true);
    setError(null);
    try {
      if (isDemoMode) {
        await updateUserProfile({ full_name: `${f} ${l}` });
      } else {
        await completeProfile(f, l);
      }
    } catch (err) {
      setBusy(false);
      return setError(describe(err));
    }
    setBusy(false);
    if (askEmail) return sendCode(e);
    await refreshUserProfile();
  };

  const submitCode = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyEmailCode(email, value);
      if (res.status === 'attached') {
        await finish();
      } else if (res.status === 'merge_available') {
        setMergeId(res.mergeId);
        setStep('merge');
      } else if (res.status === 'needs_review') {
        setStep('support');
      } else {
        setError(t(accountErrorKey((res as any).code)));
        setCode('');
      }
    } catch (err) {
      setError(describe(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveEmailForLater(email);
      await finish();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const combine = async () => {
    if (!mergeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await commitMerge(mergeId);
      if (res.token) await signInWithToken(res.token);
      else await finish();
    } catch (err: any) {
      if (err?.code === 'reauth_required') setStep('reauth');
      else if (err?.code === 'organizer_merge_needs_review') setStep('support');
      else setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const useOtherEmail = () => {
    setStep('details');
    setEmail('');
    setTaken(false);
    setMergeId(null);
    setError(null);
    setTimeout(() => emailRef.current?.focus(), 250);
  };

  const changePhoto = () => {
    if (!user?.uid || isDemoMode) return;
    chooseImage({
      title: t('profile.photo.title'),
      hasExisting: !!userProfile?.photo_url,
      onPicked: async (asset) => {
        setPhotoBusy(true);
        try {
          const url = await uploadProfileImage(user.uid, asset, 'avatar');
          await updateUserProfile({ photo_url: url });
        } catch (e: any) {
          const key = e instanceof ProfileImageError ? e.key : null;
          showAlert(t('common.error'), key ? t(key) : t('profile.uploads.photoUploadFailed'));
        } finally {
          setPhotoBusy(false);
        }
      },
      onRemove: async () => {
        await updateUserProfile({ photo_url: '' }).catch(() => {});
      },
    });
  };

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const backFromCode = () => {
    setStep('details');
    setError(null);
    setCode('');
  };

  const header = (title: string, onBack?: () => void) => (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.back}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );

  const errorLine = error ? <Text style={styles.error}>{error}</Text> : null;

  let body: React.ReactNode;
  if (step === 'details') {
    const photo = userProfile?.photo_url;
    body = (
      <>
        {header(t('account.complete.title'), verifyOnly ? () => navigation.goBack() : undefined)}
        {!verifyOnly ? (
          <Pressable onPress={changePhoto} disabled={photoBusy} style={styles.photoRow} accessibilityRole="button">
            <Image source={photo ? { uri: photo } : defaultAvatar(user?.uid)} style={styles.avatar} contentFit="cover" />
            {photoBusy ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <Text style={styles.link}>{photo ? t('account.complete.changePhoto') : t('account.complete.addPhoto')}</Text>
            )}
          </Pressable>
        ) : null}
        {!verifyOnly || completion.needsName ? (
          <>
            <AuthInput
              icon={UserIcon}
              placeholder={t('account.complete.firstName')}
              value={first}
              onChangeText={setFirst}
              autoCapitalize="words"
              autoComplete="name-given"
              textContentType="givenName"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => lastRef.current?.focus()}
              editable={!busy}
            />
            <AuthInput
              ref={lastRef}
              icon={UserIcon}
              placeholder={t('account.complete.lastName')}
              value={last}
              onChangeText={setLast}
              autoCapitalize="words"
              autoComplete="name-family"
              textContentType="familyName"
              returnKeyType={askEmail ? 'next' : 'done'}
              blurOnSubmit={!askEmail}
              onSubmitEditing={() => (askEmail ? emailRef.current?.focus() : submitDetails())}
              editable={!busy}
            />
          </>
        ) : null}
        {askEmail ? (
          <AuthInput
            ref={emailRef}
            icon={Mail}
            placeholder={t('account.complete.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={submitDetails}
            editable={!busy}
          />
        ) : null}
        {errorLine}
        <WhitePillCTA label={t('account.complete.continue')} onPress={submitDetails} loading={busy} size="sm" />
        {!verifyOnly ? (
          <Pressable onPress={() => signOut()} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.quiet}>
            <Text style={styles.link}>{t('account.complete.signOut')}</Text>
          </Pressable>
        ) : null}
      </>
    );
  } else if (step === 'code') {
    body = (
      <>
        {header(t('account.email.title'), backFromCode)}
        <Text style={styles.sub}>{t('account.email.sentTo', { email })}</Text>
        {taken ? <Text style={styles.sub}>{t('account.email.taken')}</Text> : null}
        <CodeCells
          ref={codeRef}
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={submitCode}
          busy={busy}
          accessibilityLabel={t('account.email.codeAccessibility')}
        />
        {errorLine}
        {busy ? <Text style={styles.muted}>{t('account.email.verifying')}</Text> : null}
        <View style={styles.linksRow}>
          <Pressable onPress={useOtherEmail} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{t('account.email.change')}</Text>
          </Pressable>
          {secondsLeft > 0 ? (
            <Text style={styles.muted}>{t('account.email.resendIn', { seconds: secondsLeft })}</Text>
          ) : (
            <Pressable onPress={() => sendCode(email)} disabled={busy} hitSlop={8} accessibilityRole="button">
              <Text style={styles.linkStrong}>{t('account.email.resend')}</Text>
            </Pressable>
          )}
        </View>
        {!taken && !verifyOnly ? (
          <Pressable onPress={later} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.quiet}>
            <Text style={styles.link}>{t('account.email.later')}</Text>
          </Pressable>
        ) : null}
      </>
    );
  } else if (step === 'merge') {
    body = (
      <>
        {header(t('account.merge.title'))}
        <Text style={styles.sub}>{t('account.merge.body', { email: maskEmail(email) })}</Text>
        {errorLine}
        <WhitePillCTA label={t('account.merge.cta')} onPress={combine} loading={busy} size="sm" />
        <Pressable onPress={useOtherEmail} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.quiet}>
          <Text style={styles.link}>{t('account.merge.useOtherEmail')}</Text>
        </Pressable>
      </>
    );
  } else if (step === 'reauth') {
    // The merge needs a sign-in from the last 10 minutes: a fresh WhatsApp
    // code for this account's own number, then the merge runs again.
    body = (
      <>
        {header(t('account.merge.confirmTitle'), () => setStep('merge'))}
        <Text style={styles.sub}>{t('account.merge.confirmPhone')}</Text>
        <PhoneCodeFlow
          ctaLabel={t('auth.phone.continueWithWhatsApp')}
          onRequestCode={(phone, iso) => requestPhoneCode(phone, iso, language)}
          onVerify={async (phone, iso, value) => {
            await signInWithPhoneCode(phone, iso, value, language);
            setStep('merge');
            await combine();
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        {header(t('account.support.title'))}
        <WhitePillCTA
          label={t('account.support.cta')}
          onPress={() =>
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('account.support.subject'))}`).catch(() => {})
          }
          size="sm"
        />
        <Pressable onPress={useOtherEmail} hitSlop={8} accessibilityRole="button" style={styles.quiet}>
          <Text style={styles.link}>{t('account.merge.useOtherEmail')}</Text>
        </Pressable>
      </>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.form}>{body}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl },
  form: { gap: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  back: { marginLeft: -6 },
  title: { ...type.title, color: colors.textPrimary, flex: 1 },
  sub: { ...type.body, color: colors.textSecondary },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface },
  error: { color: colors.red, fontSize: 13 },
  muted: { color: colors.textTertiary, fontSize: 13 },
  link: { color: colors.textSecondary, fontSize: 14 },
  linkStrong: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  linksRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  quiet: { alignSelf: 'center', paddingVertical: spacing.sm },
});
