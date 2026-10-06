import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import WhitePillCTA from './WhitePillCTA';
import { radius } from '../theme/tokens';
import { attendanceVisibilityUnset } from '../types/social';

interface Props {
  /** Open the privacy settings (the Profile tab). */
  onOpenSettings: () => void;
}

/**
 * One-time notice on Home (owner decision, 2026-10): attendance visibility now
 * defaults to "Friends". Shown only to a signed-in user who never chose a
 * setting, once per ACCOUNT: seeing it stamps
 * `users.attendance_default_notice_seen_at` (an owner-writable profile field,
 * firestore.rules users update), so it survives sign-out and a new device.
 * Dismissing it or opening the settings both count as seen.
 */
export default function AttendanceDefaultNotice({ onOpenSettings }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user, userProfile, updateUserProfile } = useAuth();
  const [hidden, setHidden] = useState(false);

  if (
    hidden ||
    !user ||
    !userProfile ||
    !attendanceVisibilityUnset(userProfile.privacy) ||
    userProfile.attendance_default_notice_seen_at
  ) {
    return null;
  }

  const markSeen = () => {
    setHidden(true);
    updateUserProfile({ attendance_default_notice_seen_at: new Date().toISOString() }).catch((err) =>
      console.warn('[attendance-notice] could not record the notice as seen', err)
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Pressable
        onPress={markSeen}
        hitSlop={10}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('home.attendanceNotice.dismiss')}
      >
        <X size={16} color={colors.textSecondary} strokeWidth={2.2} />
      </Pressable>
      <Text style={[styles.body, { color: colors.text }]}>{t('home.attendanceNotice.body')}</Text>
      <WhitePillCTA
        compact
        label={t('home.attendanceNotice.cta')}
        style={styles.cta}
        onPress={() => {
          markSeen();
          onOpenSettings();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    paddingRight: 40,
    borderRadius: radius.lg,
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  cta: {
    alignSelf: 'flex-start',
    marginTop: 12,
  },
});
