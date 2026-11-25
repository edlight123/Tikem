import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Mail } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { colors, radius, spacing } from '../../theme/tokens';
import { profileCompletion } from '../../lib/profileCompletion';

/**
 * The quiet reminder after "Verify later": one 40pt filled strip, a line icon,
 * the address and a "Verify" link. Renders nothing once the email is verified.
 */
export default function VerifyEmailStrip() {
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuth();
  const c = profileCompletion({
    fullName: userProfile?.full_name,
    authEmail: user?.email,
    pendingEmail: userProfile?.pending_email,
  });
  if (!user || !c.emailUnverified) return null;

  return (
    <Pressable
      onPress={() => navigation.navigate('VerifyEmail', { mode: 'verify' })}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${t('account.reminder.label')}, ${userProfile?.pending_email ?? ''}`}
    >
      <Mail size={16} color={colors.textSecondary} strokeWidth={1.75} />
      <View style={styles.textWrap}>
        <Text style={styles.label} numberOfLines={1}>
          {t('account.reminder.label')}
          <Text style={styles.email}>{`  ${userProfile?.pending_email ?? ''}`}</Text>
        </Text>
      </View>
      <Text style={styles.action}>{t('account.reminder.action')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  textWrap: { flex: 1 },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  email: { color: colors.textTertiary, fontWeight: '400' },
  action: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
