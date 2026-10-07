import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, UserPlus, Users } from 'lucide-react-native';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import VerifiedBadge from '../components/VerifiedBadge';
import WhitePillCTA from '../components/WhitePillCTA';
import { PeopleRowsSkeleton } from '../components/Skeleton';
import { font, radius } from '../theme/tokens';
import { useOpenAttendeeTab } from '../hooks/useOpenAttendeeTab';

type Subscription = {
  id: string;
  name: string;
  avatar?: string | null;
  isVerified?: boolean;
};

/**
 * The organizers/channels the signed-in user follows — i.e. THEIR OWN
 * subscriptions (organizer_follows where follower_id == me). This is the user's
 * own data, so the full list is shown. (Followers — people who follow you — stay
 * a count only for privacy; there is no screen listing their identities.)
 */
export default function SubscriptionsScreen({ navigation }: any) {
  const openAttendeeTab = useOpenAttendeeTab();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { user } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // The title bar is a blurred overlay now, so the list beneath reserves its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once the list has actually scrolled underneath (see OverlayHeader).
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const followsSnap = await getDocs(
        query(collection(db, 'organizer_follows'), where('follower_id', '==', user.uid)),
      );
      const organizerIds = Array.from(
        new Set(followsSnap.docs.map((d) => String((d.data() as any).organizer_id || '')).filter(Boolean)),
      );

      const resolved = await Promise.all(
        organizerIds.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'public_profiles', id));
            const data = snap.exists() ? (snap.data() as any) : {};
            return {
              id,
              name: data.organization_name || data.full_name || t('subscriptions.unknownOrganizer'),
              avatar: data.organization_logo || data.photo_url || null,
              isVerified: !!data.is_verified,
            } as Subscription;
          } catch {
            return { id, name: t('subscriptions.unknownOrganizer') } as Subscription;
          }
        }),
      );
      resolved.sort((a, b) => a.name.localeCompare(b.name));
      setItems(resolved);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ArrowLeft size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{t('subscriptions.title')}</Text>
      <View style={styles.backButton} />
    </OverlayHeader>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      {header}
      {loading ? (
        // No scroll container here — pad the placeholder rows by hand.
        <View style={{ paddingTop: headerH }}>
          <PeopleRowsSkeleton count={6} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={UserPlus}
            title={t('subscriptions.emptyTitle')}
            subtitle={t('subscriptions.emptyBody')}
          />
          <WhitePillCTA
            label={t('favorites.explore')}
            onPress={() => openAttendeeTab('Discover')}
            style={styles.emptyCta}
          />
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingTop: headerH + 16,
            paddingBottom: 24 + insets.bottom,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
        >
          <View style={styles.card}>
            {items.map((s, i) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.row, i > 0 && styles.rowDivided]}
                onPress={() => navigation.navigate('OrganizerProfile', { organizerId: s.id })}
                activeOpacity={0.7}
              >
                {s.avatar ? (
                  <Image source={{ uri: s.avatar }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Users size={20} color={colors.textSecondary} />
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {s.name}
                  </Text>
                </View>
                {s.isVerified && <VerifiedBadge size="small" style={styles.rowVerified} />}
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Overlay chrome (OverlayHeader owns the safe-area padding, the row layout,
    // the blur backdrop and the absolute placement) — only the horizontal inset
    // is ours. No fill and no hairline: they would paint over the blur.
    header: {
      paddingHorizontal: 8,
    },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    emptyCta: { marginTop: 24, minWidth: 200 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.borderLight },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1 },
    rowName: { fontFamily: font.serif, fontSize: 17, color: colors.text },
    rowVerified: { marginRight: 2 },
  });
