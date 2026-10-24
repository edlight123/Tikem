import React, { useCallback, useRef, useState } from 'react';
import { Animated, RefreshControl, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import { backendJson } from '../lib/api/backend';
import { safeFormatForLanguage } from '../lib/dates';
import { font, radius } from '../theme/tokens';

/** One row of GET /api/messages (lib/organizer-messages AttendeeThreadSummary). */
export type AttendeeThreadSummary = {
  id: string;
  event_id: string;
  event_title: string;
  event_poster: string | null;
  organizer_name: string;
  topic: string;
  last_message_preview: string;
  last_message_role: 'attendee' | 'organizer';
  last_activity_at: string | null;
  unread: boolean;
};

/**
 * The attendee's conversations with organizers: every question they sent from
 * an event page, newest activity first, with the event poster, the last message
 * and an unread dot when the organizer has answered since they last looked.
 *
 * Reached from Profile > Messages. Everything goes through /api/messages; the
 * replies are server-only by design, so there is no Firestore read here.
 */
export default function MessagesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;

  const [threads, setThreads] = useState<AttendeeThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await backendJson<{ threads: AttendeeThreadSummary[] }>('/api/messages');
      setThreads(res?.threads || []);
      setFailed(false);
    } catch (e) {
      console.warn('Failed to load messages', e);
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch on focus: coming back from a thread clears its dot and moves it up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const when = (iso: string | null) => (iso ? safeFormatForLanguage(iso, 'MMM d', language) : '');

  const open = (thread: AttendeeThreadSummary) => {
    setThreads((prev) => prev.map((th) => (th.id === thread.id ? { ...th, unread: false } : th)));
    navigation.navigate('MessageThread', { threadId: thread.id, eventTitle: thread.event_title });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('attendeeMessages.title')}</Text>
        <View style={styles.backButton} />
      </OverlayHeader>

      {loading ? (
        <View style={{ paddingTop: headerH + 16, paddingHorizontal: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={48} height={60} radius={radius.poster} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="60%" height={16} radius={4} />
                <Skeleton width="85%" height={12} radius={4} />
              </View>
            </View>
          ))}
        </View>
      ) : threads.length === 0 ? (
        <View style={[styles.emptyWrap, { paddingTop: headerH }]}>
          <EmptyState
            icon={MessageCircle}
            title={failed ? t('attendeeMessages.loadFailed') : t('attendeeMessages.emptyTitle')}
            subtitle={failed ? undefined : t('attendeeMessages.emptyBody')}
          />
          {failed ? (
            <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); load(); }}>
              <Text style={styles.retryText}>{t('attendeeMessages.retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: headerH + 16, paddingBottom: 24 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
              progressViewOffset={headerH}
            />
          }
        >
          <View style={styles.card}>
            {threads.map((th, i) => {
              const who =
                th.last_message_role === 'attendee'
                  ? `${t('attendeeMessages.you')}: `
                  : th.organizer_name
                    ? `${th.organizer_name}: `
                    : '';
              return (
                <TouchableOpacity
                  key={th.id}
                  style={[styles.row, i > 0 && styles.rowDivided]}
                  onPress={() => open(th)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${th.event_title}. ${who}${th.last_message_preview}${th.unread ? `. ${t('attendeeMessages.newReply')}` : ''}`}
                >
                  {th.event_poster ? (
                    <Image source={{ uri: th.event_poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, styles.posterFallback]}>
                      <MessageCircle size={18} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <View style={styles.rowHead}>
                      <Text style={[styles.rowTitle, !th.unread && styles.rowTitleRead]} numberOfLines={1}>
                        {th.event_title}
                      </Text>
                      <Text style={styles.rowWhen}>{when(th.last_activity_at)}</Text>
                    </View>
                    <View style={styles.rowFoot}>
                      <Text style={[styles.rowPreview, th.unread && styles.rowPreviewUnread]} numberOfLines={2}>
                        {who}
                        {th.last_message_preview}
                      </Text>
                      {th.unread ? <View style={styles.unreadDot} /> : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
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
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    retry: {
      marginTop: 20,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
    },
    retryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    poster: { width: 48, height: 60, borderRadius: radius.poster, backgroundColor: colors.surfaceRaised },
    posterFallback: { alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, minWidth: 0 },
    rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    rowTitle: { flex: 1, fontFamily: font.serif, fontSize: 18, color: colors.text },
    rowTitleRead: { color: colors.textSecondary },
    rowWhen: { fontSize: 11, color: colors.textTertiary },
    rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
    rowPreview: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textTertiary },
    rowPreviewUnread: { color: colors.textSecondary },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  });
