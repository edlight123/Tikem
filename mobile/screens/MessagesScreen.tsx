import React, { useCallback, useRef, useState } from 'react';
import { Animated, RefreshControl, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MessageCircle } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton, ShimmerImage } from '../components/Skeleton';
import { refreshAttendeeUnread } from '../lib/attendeeUnread';
import { backendJson } from '../lib/api/backend';
import { safeFormatForLanguage } from '../lib/dates';
import { font, radius } from '../theme/tokens';
import { Touchable } from '../components/ui/Touchable';
import { useFocusPoll } from '../hooks/useFocusPoll';

/** Quiet refresh while the list is open. */
const INBOX_POLL_MS = 15_000;

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

  // `silent`: the background poll. A failed poll keeps what is on screen.
  const load = useCallback(async (silent = false) => {
    try {
      const res = await backendJson<{ threads: AttendeeThreadSummary[] }>('/api/messages');
      setThreads(res?.threads || []);
      setFailed(false);
      // Keep the Profile tab's dot in step with what this list shows.
      refreshAttendeeUnread();
    } catch (e) {
      if (!silent) {
        console.warn('Failed to load messages', e);
        setFailed(true);
      }
    } finally {
      setLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, []);

  // Refetch on focus: coming back from a thread clears its dot and moves it up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  // While the list stays open, new replies arrive quietly.
  useFocusPoll(useCallback(() => load(true), [load]), INBOX_POLL_MS);

  const when = (iso: string | null) => (iso ? safeFormatForLanguage(iso, 'MMM d', language) : '');

  const open = (thread: AttendeeThreadSummary) => {
    setThreads((prev) => prev.map((th) => (th.id === thread.id ? { ...th, unread: false } : th)));
    navigation.navigate('MessageThread', { threadId: thread.id, eventTitle: thread.event_title });
  };

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
        <Text style={styles.headerTitle}>{t('attendeeMessages.title')}</Text>
        <View style={styles.backButton} />
      </OverlayHeader>

      {loading ? (
        // The loaded list's exact frame: the same filled card, 16pt row gutter
        // and hairlines between rows, serif title with its date on the right,
        // two preview lines. (The old rows sat bare on the canvas with no
        // card, so the list jumped inward when it loaded.)
        <View style={{ paddingTop: headerH + 16, paddingHorizontal: 16 }}>
          <View style={styles.card}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.row, i > 0 && styles.rowDivided]}>
                <Skeleton width={48} height={60} radius={radius.poster} />
                <View style={styles.rowText}>
                  <View style={styles.skeletonHead}>
                    <Skeleton width={i % 2 ? '52%' : '64%'} height={16} radius={4} />
                    <Skeleton width={34} height={11} radius={4} />
                  </View>
                  <Skeleton width="88%" height={12} radius={4} style={{ marginTop: 6 }} />
                  <Skeleton width={i % 2 ? '40%' : '58%'} height={12} radius={4} style={{ marginTop: 6 }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : threads.length === 0 ? (
        <View style={[styles.emptyWrap, { paddingTop: headerH }]}>
          <EmptyState
            icon={MessageCircle}
            title={failed ? t('attendeeMessages.loadFailed') : t('attendeeMessages.emptyTitle')}
          />
          {failed ? (
            <Touchable style={styles.retry} onPress={() => { setLoading(true); load(); }} accessibilityRole="button">
              <Text style={styles.retryText}>{t('attendeeMessages.retry')}</Text>
            </Touchable>
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
                <Touchable
                  key={th.id}
                  style={[styles.row, i > 0 && styles.rowDivided]}
                  onPress={() => open(th)}
                  scale={false}
                  pressedColor={colors.surfaceRaised}
                  accessibilityRole="button"
                  accessibilityLabel={`${th.event_title}. ${who}${th.last_message_preview}${th.unread ? `. ${t('attendeeMessages.newReply')}` : ''}`}
                >
                  {th.event_poster ? (
                    <View style={[styles.poster, styles.posterFrame]}>
                      <ShimmerImage uri={th.event_poster} recyclingKey={th.id} />
                    </View>
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
                </Touchable>
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
    retryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    skeletonHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 22 },
    posterFrame: { overflow: 'hidden' },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    poster: { width: 48, height: 60, borderRadius: radius.poster, backgroundColor: colors.surfaceRaised },
    posterFallback: { alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, minWidth: 0 },
    rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    rowTitle: { flex: 1, fontFamily: font.serif, fontSize: 18, color: colors.text },
    rowTitleRead: { color: colors.textSecondary },
    rowWhen: { fontSize: 12, color: colors.textTertiary },
    rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
    rowPreview: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textTertiary },
    rowPreviewUnread: { color: colors.textSecondary },
    unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.primary },
  });
