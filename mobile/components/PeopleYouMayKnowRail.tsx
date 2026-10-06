import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { UserPlus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useSocialFlags } from '../lib/socialFlags';
import { fetchFriendSuggestions } from '../lib/api/social';
import SectionHeader from './SectionHeader';
import PersonAvatar from './PersonAvatar';
import ConnectButton from './ConnectButton';
import VerifiedBadge from './VerifiedBadge';
import type { FriendSuggestion } from '../types/social';

/** Fewer than this and the rail is not worth the space. */
export const MIN_RAIL_SUGGESTIONS = 3;

/** "3 mutual friends" / "Goes to the same events". Never names the events. */
export function suggestionReasonLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  s: Pick<FriendSuggestion, 'reason' | 'mutualCount'>,
): string {
  return s.reason === 'mutual_friends'
    ? t('friendSuggestions.mutual', { count: s.mutualCount })
    : t('friendSuggestions.sameEvents');
}

/**
 * Home: "people you may know". Only with config/auth.friend_suggestions on,
 * signed in, and at least MIN_RAIL_SUGGESTIONS people; otherwise nothing at
 * all (no header, no gap). Ends with a "find friends from contacts" card.
 */
export default function PeopleYouMayKnowRail({ style }: { style?: any }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const flags = useSocialFlags();
  const navigation: any = useNavigation();
  const styles = getStyles(colors);
  const [items, setItems] = useState<FriendSuggestion[]>([]);

  const on = flags.friendSuggestions && !!user;
  useEffect(() => {
    if (!on) {
      setItems([]);
      return;
    }
    let active = true;
    fetchFriendSuggestions().then((list) => {
      if (active) setItems(list);
    });
    return () => {
      active = false;
    };
  }, [on, user?.uid]);

  if (!on || items.length < MIN_RAIL_SUGGESTIONS) return null;

  const openProfile = (uid: string) => navigation.navigate('OrganizerProfile', { organizerId: uid });

  return (
    <View style={style}>
      <SectionHeader
        title={t('friendSuggestions.title')}
        onViewAll={() => navigation.navigate('Connections', { initialTab: 'find' })}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
        {items.map((s) => (
          <View key={s.uid} style={styles.card}>
            <TouchableOpacity onPress={() => openProfile(s.uid)} activeOpacity={0.8} style={styles.cardTop}>
              <PersonAvatar user={s} size={64} />
              <Text style={styles.name} numberOfLines={1}>
                {s.displayName}
              </Text>
              {s.isVerified ? <VerifiedBadge size="small" /> : null}
              <Text style={styles.reason} numberOfLines={2}>
                {suggestionReasonLabel(t, s)}
              </Text>
            </TouchableOpacity>
            <ConnectButton targetUserId={s.uid} initialState="none" size="sm" />
          </View>
        ))}
        <TouchableOpacity
          style={[styles.card, styles.contactsCard]}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Connections', { autoSync: true })}
          accessibilityRole="button"
        >
          <View style={styles.contactsIcon}>
            <UserPlus size={24} color={colors.text} />
          </View>
          <Text style={styles.name} numberOfLines={2}>
            {t('friendSuggestions.contactsCta')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    // Bleeds to the screen edges like EventRail (the section pads 16).
    scroll: {
      marginHorizontal: -16,
    },
    content: {
      gap: 10,
      paddingHorizontal: 16,
    },
    // Filled card (fill, not a hairline), same rhythm as the event rails.
    card: {
      width: 148,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 12,
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    cardTop: {
      alignItems: 'center',
      gap: 6,
    },
    name: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    reason: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 16,
    },
    contactsCard: {
      justifyContent: 'center',
    },
    contactsIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
