import React from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useI18n } from '../../contexts/I18nContext';
import { colors } from '../../theme/tokens';

// www directly: the apex 308-redirects to www (harmless in a browser, but one
// hop fewer).
const TERMS_URL = 'https://www.tikem.co/legal/terms';
const PRIVACY_URL = 'https://www.tikem.co/legal/privacy';

/**
 * "By continuing you agree to our Terms of Service and Privacy Policy…"
 *
 * App Store guideline 1.2 requires users to agree to terms that forbid
 * objectionable content before they can use a user-generated-content app.
 * Every account is created from the Signup or Login screen (email, Google or
 * Apple), so both show this line. The pages open in an in-app browser because
 * the ContentPage screen only exists in the signed-in navigator.
 */
export function TermsAgreement({ style }: { style?: StyleProp<TextStyle> }) {
  const { t } = useI18n();
  const open = (url: string) => {
    WebBrowser.openBrowserAsync(url).catch(() => {});
  };
  return (
    <Text style={[styles.text, style]}>
      {t('auth.terms.prefix')}{' '}
      <Text style={styles.link} onPress={() => open(TERMS_URL)} accessibilityRole="link">
        {t('auth.terms.termsLink')}
      </Text>{' '}
      {t('auth.terms.and')}{' '}
      <Text style={styles.link} onPress={() => open(PRIVACY_URL)} accessibilityRole="link">
        {t('auth.terms.privacyLink')}
      </Text>
      {t('auth.terms.suffix')}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  link: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
