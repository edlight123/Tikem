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
import { Mail, Lock } from 'lucide-react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { AuthBackground } from '../../components/auth/AuthBackground';
import { TikemWordmark } from '../../components/TikemWordmark';
import { AuthInput } from '../../components/auth/AuthInput';
import { SecondaryPill } from '../../components/auth/SecondaryPill';
import * as AppleAuthentication from 'expo-apple-authentication';
import { TermsAgreement } from '../../components/auth/TermsAgreement';
import WhitePillCTA from '../../components/WhitePillCTA';
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

export default function LoginScreen({ navigation }: any) {
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithGoogle, signInWithApple, appleAuthAvailable } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  // Entrance animations — headline settles first, then the form cluster rises.
  const headlineAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(40)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(headlineAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(formOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert(t('common.error'), t('auth.login.errors.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (error: any) {
      showAlert(t('auth.login.errors.loginFailedTitle'), t(firebaseErrorKey(error?.code)));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      showAlert(t('common.error'), t('auth.login.enterEmailFirst'));
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed.toLowerCase());
      showAlert(t('auth.login.resetSentTitle'), t('auth.login.resetSentBody'));
    } catch (error: any) {
      showAlert(t('common.error'), t(firebaseErrorKey(error?.code)));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      // Firebase codes map to localized messages; the unconfigured-build case
      // (a plain Error, no code) falls back to the config-required copy.
      const msg = error?.code ? t(firebaseErrorKey(error.code)) : t('auth.login.google.configRequired');
      showAlert(t('auth.login.google.title'), msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithApple();
    } catch (error: any) {
      // User-cancelled (ERR_REQUEST_CANCELED) is not an error worth alerting.
      if (error?.code !== 'ERR_REQUEST_CANCELED') {
        showAlert(t('auth.apple.title'), t('auth.apple.genericError'));
      }
    } finally {
      setLoading(false);
    }
  };

  const headlineOpacity = headlineAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 1] });
  const headlineTranslate = headlineAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <AuthBackground>
      {/* iOS relies on the ScrollView's automaticallyAdjustKeyboardInsets to
          scroll the focused field into view (a KeyboardAvoidingView's flex:1
          spacer collapsed and snapped the form to the top). Android ignores that
          prop, so we wrap in a KeyboardAvoidingView with behavior="height" for
          Android only — undefined on iOS keeps it a no-op there and avoids the
          double-adjust jump. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? undefined : 'height'}
      >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        automaticallyAdjustKeyboardInsets
      >
          {/* Brand wordmark, centered in the upper band above the form */}
          <Animated.View style={[styles.brand, { opacity: headlineOpacity, transform: [{ translateY: headlineTranslate }] }]}>
            <TikemWordmark fontSize={64} />
          </Animated.View>

          {/* Lower cluster — form + auth buttons grouped tight, left-aligned */}
          <Animated.View style={{ transform: [{ translateY: formAnim }], opacity: formOpacity }}>
            <View style={styles.form}>
              <AuthInput
                icon={Mail}
                placeholder={t('auth.login.placeholders.email')}
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
                placeholder={t('auth.login.placeholders.password')}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                editable={!loading}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />

              {/* Forgot password — sends a reset email to the entered address */}
              <Pressable
                onPress={handleForgotPassword}
                disabled={loading}
                hitSlop={8}
                accessibilityRole="button"
                style={styles.forgot}
              >
                <Text style={styles.forgotText}>{t('auth.login.forgotPassword')}</Text>
              </Pressable>

              {/* Primary action — the one white pill per screen (POSH §2.2) */}
              <WhitePillCTA
                label={loading ? t('auth.login.signingIn') : t('auth.login.signIn')}
                onPress={handleLogin}
                loading={loading}
                style={styles.primary}
              />

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('auth.login.or')}</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Secondary action — dark-grey pill, never teal */}
              <SecondaryPill
                label={t('auth.login.continueWithGoogle')}
                onPress={handleGoogleSignIn}
                disabled={loading}
              />

              {/* Sign in with Apple — Apple's HIG-compliant native button.
                  Only renders on iOS with the native module present. */}
              {appleAuthAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={28}
                  style={styles.appleButton}
                  onPress={handleAppleSignIn}
                />
              )}

              {/* Google / Apple here create an account on first use, so the
                  Terms line belongs on this screen too (App Store 1.2). */}
              <TermsAgreement />

              <Pressable
                onPress={() => navigation.navigate('Signup')}
                disabled={loading}
                hitSlop={8}
                accessibilityRole="button"
                style={styles.linkButton}
              >
                <Text style={styles.linkText}>
                  {t('auth.login.noAccount')}{' '}
                  <Text style={styles.linkTextBold}>{t('auth.login.signUp')}</Text>
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
  },
  brand: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    gap: spacing.md,
  },
  primary: {
    marginTop: spacing.xs,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: -spacing.xs,
  },
  forgotText: {
    color: colors.textSecondary,
    fontSize: 13,
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
