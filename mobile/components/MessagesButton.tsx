import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Inbox } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAttendeeUnread } from '../lib/attendeeUnread';
import { colors as T } from '../theme/tokens';
import { Touchable } from './ui/Touchable';

/**
 * Messages one tap away from the Home and Profile headers (Tikra ef0062d4):
 * the same inbox-tray line icon as the organizer Inbox tab (the owner prefers
 * it to a chat bubble), with the unread count in the tab bar's badge style.
 * Signed-in only; the count is conversations with an organizer reply the
 * attendee hasn't opened (lib/attendeeUnread, shared with the Profile dot).
 */
export default function MessagesButton({ size = 20, style }: { size?: number; style?: object }) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const unread = useAttendeeUnread({ enabled: !!user?.uid, userKey: user?.uid || null });
  if (!user?.uid) return null;
  const label = unread > 0 ? `${t('attendeeMessages.title')}, ${unread}` : t('attendeeMessages.title');
  return (
    <Touchable
      style={[styles.button, style]}
      onPress={() => navigation.navigate('Messages')}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Inbox size={size} color={colors.text} strokeWidth={1.75} />
      {unread > 0 ? (
        <View style={[styles.badge, { borderColor: colors.background }]}>
          <Text style={styles.badgeText} allowFontScaling={false}>
            {unread > 9 ? '9+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // A small count badge: one of the few true circles the radius rule allows.
  badge: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: T.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: '700', color: T.onTeal, fontVariant: ['tabular-nums'] },
});
