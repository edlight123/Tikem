import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { fetchEventSocial } from '../lib/api/social';
import { colors as T, radius } from '../theme/tokens';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import type { GuestlistVisibility } from '../lib/guestlistVisibility';
import type { EventSocialAttendance, PublicUserSummary } from '../types/social';
import { shouldShowGoingCount } from '../lib/socialProof';

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
  /** The event's ticket capacity: the count only prints once half of it is
   *  taken (shouldShowGoingCount). Unset means no count, faces only. */
  capacity?: number | null;
}

/** Faces sit in a ring of the canvas colour, so the pile reads as cut-outs
 *  on the page rather than white-outlined stickers. */
function Avatar({ user, size = 44, ring }: { user: PublicUserSummary; size?: number; ring: string }) {
  const initial = (user.displayName || 'U').charAt(0).toUpperCase();
  const frame = { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ring };
  if (user.photoURL) {
    return (
      <Image
        source={{ uri: user.photoURL }}
        style={frame}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        recyclingKey={user.uid ? String(user.uid) : undefined}
      />
    );
  }
  return (
    <View style={[frame, { backgroundColor: T.surfaceRaised, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: T.textPrimary, fontWeight: '700', fontSize: size * 0.38 }}>{initial}</Text>
    </View>
  );
}

export default function WhosGoing({ eventId, visibility = 'faces', capacity }: WhosGoingProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
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

  // The shared section rail, same component as "about" and "hosted by" above.
  const heading = <SectionHeader title={t('whosGoing.title')} />;

  if (loading) {
    return (
      <View style={styles.section}>
        {heading}
        <ActivityIndicator size="small" color={colors.textSecondary} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  }

  if (!data || data.totalGoing === 0) return null;

  const { totalGoing, viewerIsGoing, friendsGoing, publicGoing } = data;

  // A small number talks people out of going, so it only prints once the
  // event is at least half full. Below that: faces and names, no number.
  const showCount = shouldShowGoingCount(totalGoing, capacity);

  // The headline number, set large in the serif: the count IS the social proof.
  const headline = showCount ? (
    <Text style={styles.headline}>{t('whosGoing.goingCount', { count: totalGoing })}</Text>
  ) : null;

  // 'count': the number and nothing that identifies anyone. With the number
  // held back there is nothing left to show but the viewer's own RSVP.
  if (visibility === 'count') {
    if (!showCount && !viewerIsGoing) return null;
    return (
      <View style={styles.section}>
        {heading}
        {headline}
        {viewerIsGoing && <Text style={styles.sub}>{t('whosGoing.youreGoing')}</Text>}
      </View>
    );
  }

  const pile = publicGoing.slice(0, 5);
  const named = friendsGoing.length + pile.length + (viewerIsGoing ? 1 : 0);
  const remaining = showCount ? Math.max(0, totalGoing - named) : 0;

  // Nobody shows a face: a private list. One quiet filled row, not a box with
  // a lonely "You" bubble in it.
  if (friendsGoing.length === 0 && pile.length === 0) {
    if (!showCount && !viewerIsGoing) return null;
    return (
      <View style={styles.section}>
        {heading}
        <View style={styles.privateRow}>
          <View style={styles.privateIcon}>
            <Lock size={16} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.privateTitle}>
              {viewerIsGoing && showCount
                ? `${t('whosGoing.youreGoing')} · ${t('whosGoing.goingCount', { count: totalGoing })}`
                : viewerIsGoing
                  ? t('whosGoing.youreGoing')
                  : t('whosGoing.goingCount', { count: totalGoing })}
            </Text>
            <Text style={styles.privateSub}>{t('whosGoing.privateSub')}</Text>
          </View>
        </View>
      </View>
    );
  }

  // "Mika, Jean and 3 friends": naming faces makes the pile a sentence.
  const lead = (friendsGoing[0]?.displayName || publicGoing[0]?.displayName || '').split(' ')[0];
  const subLine = viewerIsGoing
    ? t('whosGoing.youreGoing')
    : friendsGoing.length > 0
      ? t(friendsGoing.length === 1 ? 'whosGoing.friendGoingOne' : 'whosGoing.friendGoingOther', {
          count: friendsGoing.length,
        })
      : !lead
        ? null
        : totalGoing <= 1
          ? t('whosGoing.leadOnly', { name: lead })
          : !showCount
            ? t('whosGoing.leadAndOthersVague', { name: lead })
            : totalGoing === 2
              ? t('whosGoing.leadAndOne', { name: lead })
              : t('whosGoing.leadAndOthers', { name: lead, count: totalGoing - 1 });

  const faces = [...friendsGoing, ...pile].slice(0, 5);

  return (
    <View style={styles.section}>
      {heading}

      <View style={styles.pile}>
        {faces.map((u, i) => (
          <TouchableOpacity
            key={u.uid}
            onPress={() => goToProfile(u.uid)}
            style={{ marginLeft: i === 0 ? 0 : -12, zIndex: faces.length - i }}
            activeOpacity={0.8}
          >
            <Avatar user={u} size={48} ring={colors.background} />
          </TouchableOpacity>
        ))}
        {remaining > 0 && (
          <View style={[styles.moreBubble, { marginLeft: faces.length ? -12 : 0 }]}>
            <Text style={styles.moreText}>+{remaining}</Text>
          </View>
        )}
      </View>

      {headline}
      {!!subLine && <Text style={styles.sub}>{subLine}</Text>}

      {friendsGoing.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}
        >
          {friendsGoing.map((f) => (
            <TouchableOpacity key={f.uid} style={styles.chip} onPress={() => goToProfile(f.uid)} activeOpacity={0.8}>
              <Avatar user={f} size={24} ring={T.surface} />
              <Text style={styles.chipName} numberOfLines={1}>
                {(f.displayName || '').split(' ')[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    // On the page gutter, no card: the old bordered box sat 16pt inside the
    // content padding, so it was indented from every other section.
    section: {
      marginTop: 32,
    },
    pile: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    moreBubble: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: T.surfaceRaised,
      borderWidth: 2,
      borderColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    headline: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 38,
      lineHeight: 44,
      color: colors.text,
      marginTop: 14,
    },
    sub: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    chipsScroll: {
      marginTop: 16,
      marginHorizontal: -18,
    },
    chips: {
      gap: 8,
      paddingHorizontal: 18,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: T.surface,
      // A rounded rectangle, not a stadium: no pill shapes (house rule).
      borderRadius: radius.md,
      paddingLeft: 6,
      paddingRight: 14,
      paddingVertical: 6,
      maxWidth: 180,
    },
    chipName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      flexShrink: 1,
    },
    privateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: T.surface,
      borderRadius: radius.lg,
      padding: 16,
    },
    privateIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    privateTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    privateSub: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
