import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { Users, Lock } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { fetchEventSocial } from '../lib/api/social';
import { radius } from '../theme/tokens';
import { useI18n } from '../contexts/I18nContext';
import type { GuestlistVisibility } from '../lib/guestlistVisibility';
import type { EventSocialAttendance, PublicUserSummary } from '../types/social';

interface WhosGoingProps {
  eventId: string;
  /**
   * The organizer's choice in the composer, resolved with
   * guestlistVisibilityFrom. Same three modes as the web's WhosGoing:
   * 'faces' is the full section, 'count' is the number with nobody named, and
   * 'hidden' renders nothing at all (and fetches nothing, since the social
   * endpoint returns who is attending).
   */
  visibility?: GuestlistVisibility;
}

function Avatar({ user, size = 40 }: { user: PublicUserSummary; size?: number }) {
  const initial = (user.displayName || 'U').charAt(0).toUpperCase();
  if (user.photoURL) {
    return (
      <Image
        source={{ uri: user.photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#FFFFFF' }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        recyclingKey={user.uid ? String(user.uid) : undefined}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#14B8A6',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFFFFF',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.4 }}>{initial}</Text>
    </View>
  );
}

export default function WhosGoing({ eventId, visibility = 'faces' }: WhosGoingProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const { user } = useAuth();
  const [data, setData] = useState<EventSocialAttendance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visibility === 'hidden') {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchEventSocial(eventId)
      .then((d) => {
        if (active) setData(d);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, visibility]);

  const goToProfile = (uid: string) => navigation.navigate('OrganizerProfile', { organizerId: uid });

  if (visibility === 'hidden') return null;

  if (loading) {
    return (
      <View style={styles.section}>
        <View style={styles.header}>
          <Users size={20} color={colors.primary} />
          <Text style={styles.title}>{t('whosGoing.title')}</Text>
        </View>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!data || data.totalGoing === 0) return null;

  const { totalGoing, viewerIsGoing, friendsGoing, publicGoing } = data;

  // 'count': the number and nothing that identifies anyone. No faces, no
  // names, no friend row; those are exactly what this mode withholds.
  if (visibility === 'count') {
    return (
      <View style={styles.section}>
        <View style={styles.header}>
          <Users size={20} color={colors.primary} />
          <Text style={styles.title}>{t('whosGoing.goingCount', { count: totalGoing })}</Text>
        </View>
        {viewerIsGoing && <Text style={styles.countSub}>{t('whosGoing.youreGoing')}</Text>}
      </View>
    );
  }

  // "Mika and 24 others going", as on the web: naming the first face makes
  // the pile a sentence rather than a number beside strangers.
  const lead = (friendsGoing[0]?.displayName || publicGoing[0]?.displayName || '').split(' ')[0];
  const pileLabel = viewerIsGoing
    ? t('whosGoing.youreGoing')
    : lead && totalGoing > 1
      ? t('whosGoing.leadAndOthers', { name: lead, count: totalGoing - 1 })
      : t('whosGoing.goingCount', { count: totalGoing });

  const pile = publicGoing.slice(0, 6);
  const named = friendsGoing.length + pile.length + (viewerIsGoing ? 1 : 0);
  const remaining = Math.max(0, totalGoing - named);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <Users size={20} color={colors.primary} />
          <Text style={styles.title}>{t('whosGoing.title')}</Text>
        </View>
        <Text style={styles.count}>
          {t(totalGoing === 1 ? 'whosGoing.personOne' : 'whosGoing.personOther', { count: totalGoing })}
        </Text>
      </View>

      {/* Friends going */}
      {friendsGoing.length > 0 && (
        <View style={styles.friendsBlock}>
          <Text style={styles.friendsLabel}>
            {t(friendsGoing.length === 1 ? 'whosGoing.friendGoingOne' : 'whosGoing.friendGoingOther', {
              count: friendsGoing.length,
            })}
          </Text>
          <View style={styles.friendsWrap}>
            {friendsGoing.map((f) => (
              <TouchableOpacity key={f.uid} style={styles.friendChip} onPress={() => goToProfile(f.uid)} activeOpacity={0.8}>
                <Avatar user={f} size={26} />
                <Text style={styles.friendName} numberOfLines={1}>
                  {f.displayName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Public face pile */}
      {(pile.length > 0 || viewerIsGoing) && (
        <View style={styles.pileRow}>
          <View style={styles.pile}>
            {viewerIsGoing && (
              <View style={[styles.youBubble]}>
                <Text style={styles.youText}>{t('whosGoing.youBadge')}</Text>
              </View>
            )}
            {pile.map((u, i) => (
              <TouchableOpacity
                key={u.uid}
                onPress={() => goToProfile(u.uid)}
                style={{ marginLeft: i === 0 && !viewerIsGoing ? 0 : -10 }}
                activeOpacity={0.8}
              >
                <Avatar user={u} size={40} />
              </TouchableOpacity>
            ))}
            {remaining > 0 && (
              <View style={[styles.moreBubble, { marginLeft: -10 }]}>
                <Text style={styles.moreText}>+{remaining}</Text>
              </View>
            )}
          </View>
          <Text style={styles.pileLabel}>{pileLabel}</Text>
        </View>
      )}

      {/* Privacy fallback */}
      {friendsGoing.length === 0 && pile.length === 0 && (
        <View style={styles.privacyRow}>
          <Lock size={16} color={colors.textSecondary} />
          <Text style={styles.privacyText}>
            {t(totalGoing === 1 ? 'whosGoing.privacyNoteOne' : 'whosGoing.privacyNoteOther', { count: totalGoing })}
          </Text>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    section: {
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginTop: 12,
      padding: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    countSub: {
      marginTop: 4,
      fontSize: 13,
      color: colors.textSecondary,
    },
    count: {
      fontSize: 12,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
    friendsBlock: {
      marginBottom: 14,
    },
    friendsLabel: {
      fontSize: 11,
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    friendsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    friendChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primary + '14',
      borderRadius: radius.chip,
      paddingLeft: 4,
      paddingRight: 12,
      paddingVertical: 4,
      maxWidth: 180,
    },
    friendName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      flexShrink: 1,
    },
    pileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    pile: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    youBubble: {
      width: 40,
      height: 40,
      borderRadius: radius.xl,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    youText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 11,
    },
    moreBubble: {
      width: 40,
      height: 40,
      borderRadius: radius.xl,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    moreText: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    pileLabel: {
      fontSize: 12,
      letterSpacing: 0.4,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    privacyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    privacyText: {
      fontSize: 13,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },
  });
