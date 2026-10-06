import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { normalizeInviteCode, savePendingInviteCode } from '../lib/inviteLink';

/**
 * tikem://i/{code}[?e={eventId}] for a signed-in user: remember the code (the
 * claim only credits NEW accounts, the server decides) and move on to the
 * event, or home. Signed-out opens never reach this screen; AppNavigator
 * captures the code from the URL itself.
 */
export default function InviteLinkScreen() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const { colors } = useTheme();

  useEffect(() => {
    const code = normalizeInviteCode(route?.params?.code);
    const e = route?.params?.e;
    const eventId = typeof e === 'string' && e && !e.includes('/') ? e : null;
    if (code) savePendingInviteCode(code, eventId);
    if (eventId) navigation.replace('EventDetail', { eventId });
    else navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}
