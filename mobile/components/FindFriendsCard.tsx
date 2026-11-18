import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Users } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, isDemoMode } from '../config/firebase';
import { fetchConnections } from '../lib/api/social';
import { radius } from '../theme/tokens';
import AnnouncementCard from './AnnouncementCard';
import PersonAvatar from './PersonAvatar';
import type { PublicUserSummary } from '../types/social';

const DISMISS_PREFIX = 'tikem_find_friends_card_done_';

/**
 * "Find your friends": the way into Connections > Find, where friend
 * suggestions, contact matching and (when invites are on) the personal invite
 * link live. More connections is what makes recommendations better.
 *
 * - `profile`: always shown; Profile is where people go looking for it. A
 *   compact single row (owner feedback: the full announcement card was "too
 *   big and not premium" there), the whole row tappable.
 * - `home`: shown ONCE the account holds a ticket and still has no friends,
 *   until it is tapped or dismissed. Renders nothing (no gap) otherwise.
 *
 * No counts on the card itself: nothing here is fetched that could back one.
 */
export default function FindFriendsCard({ variant, style }: { variant: 'profile' | 'home'; style?: any }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { colors } = useTheme();
  const navigation: any = useNavigation();
  const [visible, setVisible] = useState(variant === 'profile');
  // Profile: the viewer's friends as a face pile (owner, 2026-11-18: the bare
  // "Find your people" row needed to be "more premium"). Null until loaded.
  const [friends, setFriends] = useState<PublicUserSummary[] | null>(null);

  useEffect(() => {
    if (variant !== 'profile' || !user?.uid || isDemoMode) return;
    let active = true;
    fetchConnections()
      .then((o) => {
        if (active) setFriends(o.friends);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [variant, user?.uid]);
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

  if (variant === 'profile') {
    const styles = getStyles(colors);
    const list = friends || [];
    const faces = [...list].sort((a, b) => Number(!!b.photoURL) - Number(!!a.photoURL)).slice(0, 4);
    const hasFriends = list.length > 0;
    return (
      <TouchableOpacity
        style={[styles.card, style]}
        onPress={open}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={hasFriends ? t('profile.findFriends.friendsTitle') : t('profile.findFriends.title')}
      >
        {hasFriends ? (
          <View style={styles.pile}>
            {faces.map((f, i) => (
              <View key={f.uid} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: faces.length - i }}>
                <View style={styles.ring}>
                  <PersonAvatar user={f} size={40} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.icon}>
            <Users size={18} color={colors.text} strokeWidth={2} />
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {hasFriends ? t('profile.findFriends.friendsTitle') : t('profile.findFriends.title')}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {hasFriends
              ? list.length === 1
                ? t('profile.findFriends.friendsCountOne')
                : t('profile.findFriends.friendsCount', { count: list.length })
              : t('profile.findFriends.rowSub')}
          </Text>
        </View>
        <View style={styles.action}>
          <Text style={styles.actionText}>{t('profile.findFriends.rowAction')}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <AnnouncementCard
      icon={Users}
      eyebrow={t('profile.findFriends.eyebrow')}
      title={t('profile.findFriends.title')}
      primary={{ label: t('profile.findFriends.cta'), onPress: open }}
      secondary={variant === 'home' ? { label: t('profile.findFriends.notNow'), onPress: markDone } : undefined}
      style={style}
    />
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    pile: { flexDirection: 'row', alignItems: 'center' },
    ring: { borderRadius: 22, borderWidth: 2, borderColor: colors.surface },
    icon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    meta: { flex: 1, minWidth: 0 },
    title: { fontSize: 15, fontWeight: '700', color: colors.text },
    sub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    // A compact raised button, the app's secondary size.
    action: {
      height: 34,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionText: { fontSize: 13, fontWeight: '700', color: colors.text },
  });
