import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Eye } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import AnnouncementCard from './AnnouncementCard';
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
    <AnnouncementCard
      icon={Eye}
      eyebrow={t('home.attendanceNotice.eyebrow')}
      title={t('home.attendanceNotice.title')}
      body={t('home.attendanceNotice.body')}
      primary={{
        label: t('home.attendanceNotice.cta'),
        onPress: () => {
          markSeen();
          onOpenSettings();
        },
      }}
      secondary={{ label: t('home.attendanceNotice.gotIt'), onPress: markSeen }}
      style={styles.card}
    />
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
});
