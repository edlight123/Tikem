import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, ChevronRight, Users } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import VerifiedBadge from '../components/VerifiedBadge';
import PersonAvatar from '../components/PersonAvatar';
import { PeopleRowsSkeleton } from '../components/Skeleton';
import { font, radius } from '../theme/tokens';
import { Touchable } from '../components/ui/Touchable';
import { backendJson } from '../lib/api/backend';
import type { PublicUserSummary } from '../types/social';

/**
 * Who follows you (owner, 2026-11-18: organizers can see their followers, not
 * only the count). Public profile fields only; a row opens that person's
 * profile. Same shape as Following (SubscriptionsScreen).
 */
export default function FollowersScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const navigation: any = useNavigation();
  const styles = getStyles(colors);
  const scrollY = useRef(new Animated.Value(0)).current;
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const [items, setItems] = useState<PublicUserSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await backendJson<{ followers: PublicUserSummary[] }>('/api/me/followers');
      setItems(data.followers || []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <Touchable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </Touchable>
        <Text style={styles.headerTitle}>{t('followers.title')}</Text>
        <View style={styles.backButton} />
      </OverlayHeader>

      {items === null ? (
        <View style={{ paddingTop: headerH }}>
          <PeopleRowsSkeleton count={6} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ paddingTop: headerH }}>
          <EmptyState variant="panel" icon={Users} title={t('followers.empty')} />
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: headerH + 16, paddingBottom: 24 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
        >
          <View style={styles.card}>
            {items.map((p, i) => (
              <Touchable
                key={p.uid}
                style={[styles.row, i > 0 && styles.rowDivided]}
                onPress={() => navigation.navigate('OrganizerProfile', { organizerId: p.uid, view: 'person' })}
                scale={false}
                pressedColor={colors.surfaceRaised}
                accessibilityRole="button"
                accessibilityLabel={p.displayName}
              >
                <PersonAvatar user={p} size={44} />
                <Text style={styles.rowName} numberOfLines={1}>
                  {p.displayName}
                </Text>
                {p.isVerified && <VerifiedBadge size="small" style={styles.rowVerified} />}
                <ChevronRight size={18} color={colors.textTertiary} />
              </Touchable>
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
    header: { paddingHorizontal: 8 },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
    rowVerified: { marginRight: 2 },
  });
