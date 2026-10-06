import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useSocialFlags } from '../lib/socialFlags';
import { fetchFriendsGoing } from '../lib/api/social';
import PersonAvatar from './PersonAvatar';
import type { FriendsGoingResponse } from '../types/social';

/**
 * "3 friends going" with their faces, on the event page. Only the viewer's
 * own connections, and only those whose privacy allows it (decided on the
 * server, lib/social/suggestions.ts). Renders nothing when the
 * friend_suggestions switch is off, signed out, or no friend is going.
 */
export default function FriendsGoingRow({ eventId }: { eventId: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const flags = useSocialFlags();
  const navigation: any = useNavigation();
  const [data, setData] = useState<FriendsGoingResponse | null>(null);
  const styles = getStyles(colors);

  const on = flags.friendSuggestions && !!user && !!eventId;
  useEffect(() => {
    if (!on) {
      setData(null);
      return;
    }
    let active = true;
    fetchFriendsGoing(eventId).then((d) => {
      if (active) setData(d);
    });
    return () => {
      active = false;
    };
  }, [on, eventId]);

  if (!on || !data || !data.enabled || data.count === 0 || data.friends.length === 0) return null;

  const label =
    data.count === 1
      ? t('friendsGoing.one', { name: data.friends[0].displayName })
      : t('friendsGoing.other', { count: data.count });

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.8}
      onPress={() => navigation.navigate('Connections', { initialTab: 'friends' })}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.pile}>
        {data.friends.map((f, i) => (
          <View key={f.uid} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: data.friends.length - i }}>
            <PersonAvatar user={f} size={32} ring />
          </View>
        ))}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    // A filled strip (fill, not a hairline).
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 20,
    },
    pile: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    label: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
  });
