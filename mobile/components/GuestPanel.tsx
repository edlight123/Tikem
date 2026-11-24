import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import EmptyState from './EmptyState';
import { Touchable } from './ui/Touchable';
import { requireAuth } from '../lib/authGate';

/**
 * What a signed-out guest sees on a tab that only means something with an
 * account (Tickets, Profile). Normally the tab tap opens the sign-in sheet
 * straight away (AppNavigator's tab bar); this panel is what is left showing
 * if the guest lands on the tab some other way (signing out from it, the
 * sheet dismissed mid-switch).
 *
 * Premium = quiet: the shared EmptyState panel (thin line icon, one short
 * line, the compact white "Sign in" pill) and a quiet "Create an account".
 * No card, no explainer paragraph.
 */
export default function GuestPanel({ icon, title, tab }: { icon: LucideIcon; title: string; tab: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const open = (screen?: 'Login' | 'Signup') =>
    requireAuth(null, navigation, { kind: 'tab', key: tab }, { screen });

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <EmptyState
        variant="panel"
        icon={icon}
        title={title}
        actionLabel={t('guest.signIn')}
        onAction={() => open('Login')}
      />
      <Touchable
        onPress={() => open('Signup')}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.secondary}
      >
        <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>{t('guest.createAccount')}</Text>
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  secondary: {
    alignSelf: 'center',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
