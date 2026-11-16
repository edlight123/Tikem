import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { fetchEventSocial } from '../lib/api/social';
import { colors as T, radius, font } from '../theme/tokens';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import GuestlistSheet from './GuestlistSheet';
import { useAuth } from '../contexts/AuthContext';
import { useAppAlert } from './AppAlert';
import type { GuestlistVisibility } from '../lib/guestlistVisibility';
import type { EventSocialAttendance, PublicUserSummary } from '../types/social';
import { shouldShowGoingCount } from '../lib/socialProof';
import { DEFAULT_AVATAR_COUNT, defaultAvatar, defaultAvatarAt, defaultAvatarIndex } from '../lib/defaultAvatar';

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
  const frame = { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ring };
  return (
    <Image
      source={user.photoURL ? { uri: user.photoURL } : defaultAvatar(String(user.uid || user.displayName || ''))}
      style={frame}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={user.photoURL ? 150 : 0}
      recyclingKey={user.uid ? String(user.uid) : undefined}
    />
  );
}

export default function WhosGoing({ eventId, visibility = 'faces', capacity }: WhosGoingProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const [data, setData] = useState<EventSocialAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { user } = useAuth();
  const showAlert = useAppAlert();

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

  // Nothing while it loads: the card appears whole rather than a heading and a
  // spinner that then jump.
  if (loading) return null;

  if (!data || data.totalGoing === 0) return null;

  const isNamed = (u: PublicUserSummary) => !!u.displayName?.trim() && u.displayName !== 'Tikèm user';
  // Nameless accounts come back as "Tikèm user": never the lead name, never a
  // face (they still count, as unnamed portraits).
  const { totalGoing, viewerIsGoing } = data;
  const friendsGoing = data.friendsGoing.filter(isNamed);
  const publicGoing = data.publicGoing.filter(isNamed);

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

  // Nobody shows a named face (guests without an account, private profiles),
  // but the organizer chose faces and others ARE going: show the crowd as
  // unnamed portraits (owner: "even for the guest list it doesn't show for
  // the scholars event"). Falls through to the pile below with no names.
  const crowdOthers = totalGoing - (viewerIsGoing ? 1 : 0);
  const showAnonCrowd = visibility === 'faces' && friendsGoing.length === 0 && pile.length === 0 && crowdOthers >= 1;

  // Nobody shows a face and nobody else is going: one quiet filled row.
  if (friendsGoing.length === 0 && pile.length === 0 && !showAnonCrowd) {
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
        ? t('whosGoing.othersGoing')
        : totalGoing <= 1
          ? t('whosGoing.leadOnly', { name: lead })
          : !showCount
            ? t('whosGoing.leadAndOthersVague', { name: lead })
            : totalGoing === 2
              ? t('whosGoing.leadAndOne', { name: lead })
              : t('whosGoing.leadAndOthers', { name: lead, count: totalGoing - 1 });

  // The card's pile: three faces, unnamed portraits filling in for guests who
  // keep themselves private, so a crowd still reads as one.
  const faces = [...friendsGoing, ...pile].slice(0, 3);
  const others = Math.max(0, totalGoing - (viewerIsGoing ? 1 : 0) - faces.length);
  const anonBase = defaultAvatarIndex(eventId);
  const anon = Array.from({ length: Math.min(others, 3 - faces.length) }, (_, i) => (anonBase + i * 5) % DEFAULT_AVATAR_COUNT);
  const pileSize = faces.length + anon.length;

  const openList = () => {
    if (!user) {
      showAlert(t('auth.loginRequiredTitle'), t('whosGoing.gateSub'));
      return;
    }
    setSheetOpen(true);
  };

  // One filled card, Posh's shape in our materials: what it is on the left,
  // the faces and "View" on the right. It replaced a left-aligned pile under a
  // heading, which sat lopsided on the page (owner, 2026-11-16).
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.card} onPress={openList} activeOpacity={0.85} accessibilityRole="button">
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{t('whosGoing.guestlist')}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {subLine || t('whosGoing.seeWhosGoing')}
          </Text>
        </View>
        <View style={styles.cardPile}>
          {faces.map((u, i) => (
            <View key={u.uid} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: pileSize - i }}>
              <Avatar user={u} size={44} ring={T.surface} />
            </View>
          ))}
          {anon.map((idx, i) => (
            <View
              key={`anon-${i}`}
              style={{ marginLeft: faces.length + i === 0 ? 0 : -14, zIndex: pileSize - faces.length - i }}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Image
                source={defaultAvatarAt(idx)}
                style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: T.surface }}
                contentFit="cover"
              />
            </View>
          ))}
        </View>
        <View style={styles.viewBtn}>
          <Text style={styles.viewText}>{t('whosGoing.view')}</Text>
        </View>
      </TouchableOpacity>

      <GuestlistSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eventId={eventId}
        previewFaces={[...friendsGoing, ...publicGoing]}
        totalGoing={totalGoing}
        showCount={showCount}
        onOpenProfile={goToProfile}
      />
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
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: T.surface,
      borderRadius: radius.lg,
      paddingVertical: 16,
      paddingLeft: 18,
      paddingRight: 14,
    },
    cardText: { flex: 1, minWidth: 0 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    cardSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    cardPile: { flexDirection: 'row', alignItems: 'center' },
    viewBtn: {
      backgroundColor: T.surfaceRaised,
      borderRadius: radius.button,
      paddingHorizontal: 16,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewText: { fontSize: 13, fontWeight: '700', color: colors.text },
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
      fontFamily: font.serif,
      fontSize: 38,
      lineHeight: 44,
      color: colors.text,
      marginTop: 14,
    },
    sub: {
      fontSize: 13,
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
      fontSize: 13,
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
  });
