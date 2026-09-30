import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { User, Mail, Lock } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { AuthBackground } from '../../components/auth/AuthBackground';
import { AuthHeadline } from '../../components/auth/AuthHeadline';
import { AuthInput } from '../../components/auth/AuthInput';
import { TermsAgreement } from '../../components/auth/TermsAgreement';
import { SecondaryPill } from '../../components/auth/SecondaryPill';
import WhitePillCTA from '../../components/WhitePillCTA';
import * as AppleAuthentication from 'expo-apple-authentication';
import { colors, spacing, type } from '../../theme/tokens';
import { useAppAlert } from '../../components/AppAlert';

// Map a Firebase auth error code to a localized message key. We never surface
// error.message (raw English) — unknown codes fall back to a generic string.
function firebaseErrorKey(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
      return 'auth.errors.invalidCredential';
    case 'auth/invalid-email':
      return 'auth.errors.invalidEmail';
    case 'auth/email-already-in-use':
      return 'auth.errors.emailAlreadyInUse';
    case 'auth/network-request-failed':
      return 'auth.errors.networkRequestFailed';
    case 'auth/too-many-requests':
      return 'auth.errors.tooManyRequests';
    case 'auth/weak-password':
      return 'auth.errors.weakPassword';
    case 'auth/user-not-found':
      return 'auth.errors.userNotFound';
    case 'auth/wrong-password':
      return 'auth.errors.wrongPassword';
    default:
      return 'auth.errors.generic';
  }
}

export default function SignupScreen({ navigation }: any) {
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp, signInWithGoogle, signInWithApple, appleAuthAvailable } = useAuth();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithApple();
    } catch (error: any) {
      if (error?.code !== 'ERR_REQUEST_CANCELED') {
        showAlert(t('auth.apple.title'), t('auth.apple.genericError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      const msg = error?.code ? t(firebaseErrorKey(error.code)) : t('auth.login.google.configRequired');
      showAlert(t('auth.login.google.title'), msg);
    } finally {
      setLoading(false);
    }
  };

  // Entrance animations — headline settles first, then the form cluster rises.
  const headlineAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(50)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(headlineAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(formOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const handleSignup = async () => {
    if (!fullName || !email || !password || !confirmPassword) {
      showAlert(t('common.error'), t('auth.signup.errors.fillAllFields'));
      return;
    }
    if (password !== confirmPassword) {
      showAlert(t('common.error'), t('auth.signup.errors.passwordsDoNotMatch'));
      return;
    }
    if (password.length < 6) {
      showAlert(t('common.error'), t('auth.signup.errors.passwordTooShort'));
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim().toLowerCase(), password, fullName.trim());
    } catch (error: any) {
      showAlert(t('auth.signup.errors.signupFailedTitle'), t(firebaseErrorKey(error?.code)));
    } finally {
      setLoading(false);
    }
  };

  const headlineOpacity = headlineAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 1] });
  const headlineTranslate = headlineAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <AuthBackground>
      {/* iOS uses the ScrollView's automaticallyAdjustKeyboardInsets; Android
          ignores it, so a KeyboardAvoidingView with behavior="height" handles
          Android. undefined behavior on iOS keeps it a no-op there and avoids
          the flex-collapse snap-to-top. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? undefined : 'height'}
      >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        automaticallyAdjustKeyboardInsets
      >
          {/* Top — brand + oversized editorial headline, left-aligned */}
          <Animated.View style={{ opacity: headlineOpacity, transform: [{ translateY: headlineTranslate }] }}>
            <AuthHeadline
              eyebrow={t('auth.signup.eyebrow')}
              lead={t('auth.signup.headlineLead')}
              accent={t('auth.signup.headlineAccent')}
            />
          </Animated.View>

          {/* Spacer keeps the form in the lower band without over-stretching */}
          <View style={styles.spacer} />

          {/* Lower cluster — form + auth buttons grouped tight, left-aligned */}
          <Animated.View style={{ transform: [{ translateY: formAnim }], opacity: formOpacity }}>
            <View style={styles.form}>
              <AuthInput
                icon={User}
                placeholder={t('auth.signup.placeholders.fullName')}
                value={fullName}
                onChangeText={setFullName}
                autoComplete="name"
                textContentType="name"
                editable={!loading}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
              <AuthInput
                ref={emailRef}
                icon={Mail}
                placeholder={t('auth.signup.placeholders.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                editable={!loading}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <AuthInput
                ref={passwordRef}
                icon={Lock}
                isPassword
                placeholder={t('auth.signup.placeholders.password')}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!loading}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
              <AuthInput
                ref={confirmRef}
                icon={Lock}
                isPassword
                placeholder={t('auth.signup.placeholders.confirmPassword')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!loading}
                returnKeyType="go"
                onSubmitEditing={handleSignup}
              />

              {/* Terms acceptance (App Store 1.2): creating an account — by
                  email, Google or Apple below — is agreeing to the Terms. */}
              <TermsAgreement />

              {/* Primary action — the one white pill per screen (POSH §2.2) */}
              <WhitePillCTA
                label={loading ? t('auth.signup.creatingAccount') : t('auth.signup.signUp')}
                onPress={handleSignup}
                loading={loading}
                style={styles.primary}
              />

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('auth.signup.or')}</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Secondary action — dark-grey pill, never teal */}
              <SecondaryPill
                label={t('auth.signup.continueWithGoogle')}
                onPress={handleGoogleSignIn}
                disabled={loading}
              />

              {/* Sign up with Apple — native HIG button; iOS + native module only. */}
              {appleAuthAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={28}
                  style={styles.appleButton}
                  onPress={handleAppleSignIn}
                />
              )}

              <Pressable
                onPress={() => navigation.navigate('Login')}
                disabled={loading}
                hitSlop={8}
                accessibilityRole="button"
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>
                  {t('auth.signup.haveAccount')}{' '}
                  <Text style={styles.linkTextBold}>{t('auth.signup.signIn')}</Text>
                </Text>
              </Pressable>
            </View>
          </Animated.View>
      </ScrollView>
      </KeyboardAvoidingView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
  },
  spacer: {
    flex: 1,
    minHeight: spacing.xxl,
  },
  form: {
    gap: spacing.md,
  },
  primary: {
    marginTop: spacing.xs,
  },
  appleButton: {
    width: '100%',
    height: 56,
  },
  linkButton: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
  linkText: {
    textAlign: 'left',
    color: colors.textSecondary,
    fontSize: 14,
  },
  linkTextBold: {
    color: colors.tealBright,
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dividerText: {
    ...type.caption,
    marginHorizontal: 14,
    color: colors.textTertiary,
  },
});
