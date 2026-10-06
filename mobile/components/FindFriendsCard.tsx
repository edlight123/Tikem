import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { X } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { colors as T, radius } from '../theme/tokens';
import { db, isDemoMode } from '../config/firebase';
import { fetchConnections } from '../lib/api/social';
import SectionHeader from './SectionHeader';

const DISMISS_PREFIX = 'tikem_find_friends_card_done_';

/**
 * "Find your friends": the way into Connections > Find, where friend
 * suggestions, contact matching and (when invites are on) the personal invite
 * link live. More connections is what makes recommendations better.
 *
 * - `profile`: always shown; Profile is where people go looking for it.
 * - `home`: shown ONCE the account holds a ticket and still has no friends,
 *   until it is tapped or dismissed. Renders nothing (no gap) otherwise.
 *
 * No counts on the card itself: nothing here is fetched that could back one.
 */
export default function FindFriendsCard({ variant, style }: { variant: 'profile' | 'home'; style?: any }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigation: any = useNavigation();
  const [visible, setVisible] = useState(variant === 'profile');
  const dismissKey = user?.uid ? `${DISMISS_PREFIX}${user.uid}` : null;

  useEffect(() => {
    if (variant !== 'home') return;
    if (!user?.uid || isDemoMode || !dismissKey) {
      setVisible(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        if ((await AsyncStorage.getItem(dismissKey)) === '1') return;
        const tickets = await getDocs(
          query(collection(db, 'tickets'), where('user_id', '==', user.uid), limit(1)),
        );
        if (tickets.empty) return;
        const overview = await fetchConnections();
        if (overview.friends.length > 0) {
          // Already has friends: the nudge has done its job for good.
          AsyncStorage.setItem(dismissKey, '1').catch(() => {});
          return;
        }
        if (active) setVisible(true);
      } catch {
        // Any failure: stay hidden rather than guess.
      }
    })();
    return () => {
      active = false;
    };
  }, [variant, user?.uid, dismissKey]);

  const markDone = useCallback(() => {
    if (variant !== 'home' || !dismissKey) return;
    setVisible(false);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
  }, [variant, dismissKey]);

  const open = () => {
    navigation.navigate('Connections', { initialTab: 'find' });
    markDone();
  };

  if (!user || !visible) return null;

  return (
    <View style={style}>
      <SectionHeader
        title={t('profile.findFriends.title')}
        trailing={
          variant === 'home' ? (
            <TouchableOpacity
              onPress={markDone}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('profile.findFriends.dismiss')}
            >
              <X size={18} color={T.textTertiary} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <View style={styles.card}>
        <Text style={styles.body}>{t('profile.findFriends.body')}</Text>
        <TouchableOpacity style={styles.cta} onPress={open} activeOpacity={0.85} accessibilityRole="button">
          <Text style={styles.ctaText}>{t('profile.findFriends.cta')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A fill, never a hairline around an empty box.
  card: {
    backgroundColor: T.surface,
    borderRadius: radius.lg,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  body: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: T.textSecondary,
  },
  cta: {
    backgroundColor: T.white,
    borderRadius: radius.button,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  ctaText: {
    color: T.onWhite,
    fontSize: 14,
    fontWeight: '700',
  },
});
