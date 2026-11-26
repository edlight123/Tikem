import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { font, radius } from '../theme/tokens';
import { backendJson } from '../lib/api/backend';

type Share = {
  id: string;
  title: string;
  image_url: string;
  status: 'live' | 'review' | 'not_approved';
  event_id: string | null;
  reason: string | null;
};

/**
 * Profile → My shared events: the community events this person shared, with
 * where each stands (Live / Waiting for review / Not approved + the reason).
 * A live one opens its event. From Tikra 245c6830.
 */
export default function MySharesScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [shares, setShares] = useState<Share[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    backendJson('/api/community/submissions')
      .then((d: any) => setShares(Array.isArray(d?.shares) ? d.shares : []))
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  // A dot and a label, never a filled status pill (house rule).
  const dot = (s: Share['status']) =>
    s === 'live' ? colors.primary : s === 'not_approved' ? colors.error : colors.textTertiary;
  const label = (s: Share['status']) =>
    s === 'live'
      ? t('community.share.statusLive')
      : s === 'review'
        ? t('community.share.statusReview')
        : t('community.share.statusNotApproved');

  const renderRow = ({ item }: { item: Share }) => {
    const live = item.status === 'live' && !!item.event_id;
    return (
      <TouchableOpacity
        style={styles.row}
        disabled={!live}
        onPress={() => live && navigation.navigate('EventDetail', { eventId: item.event_id })}
        activeOpacity={0.7}
        accessibilityRole={live ? 'link' : undefined}
      >
        <Image source={{ uri: item.image_url }} style={styles.thumb} contentFit="cover" />
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title || '—'}
          </Text>
          <View style={styles.statusLine}>
            <View style={[styles.dot, { backgroundColor: dot(item.status) }]} />
            <Text style={styles.meta} numberOfLines={1}>
              {label(item.status)}
              {item.reason ? ` · ${item.reason}` : ''}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeight} style={styles.header} scrollY={scrollY}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('community.share.mine')}
        </Text>
        <View style={styles.backButton} />
      </OverlayHeader>
      {!shares && !failed ? (
        <View style={[styles.center, { paddingTop: headerH }]}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <Animated.FlatList
          data={shares || []}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingTop: headerH + 8, paddingBottom: insets.bottom + 32 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.meta}>{failed ? t('community.share.errors.generic') : t('community.share.mineEmpty')}</Text>
              {!failed ? (
                <TouchableOpacity onPress={() => navigation.navigate('ShareEvent')} accessibilityRole="button">
                  <Text style={styles.link}>{t('community.share.entry')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
    thumb: { width: 44, height: 55, borderRadius: radius.poster, backgroundColor: colors.surface },
    rowText: { flex: 1, minWidth: 0 },
    title: { fontSize: 15, fontWeight: '600', color: colors.text },
    statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    meta: { fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
    empty: { paddingHorizontal: 20, paddingTop: 24, gap: 8 },
    link: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
