import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { MessageSquare, Send } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { colors as T, font, radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { Touchable } from '../../components/ui/Touchable';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { backendJson } from '../../lib/api/backend';
import { refreshOrganizerUnread } from '../../lib/organizerUnread';
import { defaultAvatar } from '../../lib/defaultAvatar';
import { inboxTime } from '../../lib/messageTime';
import { select as hapticSelect } from '../../lib/haptics';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import EventAnnouncements, { OrgAnnouncements } from '../../components/organizer/EventAnnouncements';

type RouteParams = {
  OrganizerMessages:
    | {
        /** Omit for the organizer's whole inbox; pass to scope to one event. */
        eventId?: string;
        eventTitle?: string;
        /** Open this conversation on arrival (the "new message" push and email). */
        thread?: string;
      }
    | undefined;
};

type Reply = {
  id: string;
  body: string;
  author_role?: 'attendee' | 'organizer';
  created_at: string | null;
  /** The teammate who wrote an organizer reply (team-only). */
  author_id?: string;
  sent_by?: string;
};

type Thread = {
  id: string;
  event_id: string;
  event_title: string;
  event_poster?: string | null;
  sender_name: string;
  sender_photo?: string | null;
  topic: string;
  message: string;
  status: 'open' | 'replied';
  /** The attendee spoke last (a new question or a follow-up). */
  needs_reply?: boolean;
  created_at: string | null;
  last_activity_at: string | null;
  reply_count: number;
  unread: boolean;
  replies: Reply[];
};

const needsReply = (th: Thread) => (typeof th.needs_reply === 'boolean' ? th.needs_reply : th.reply_count === 0);

const AVATAR = 52;
const POSTER_W = 22;
const POSTER_H = 28;

/**
 * The organizer's inbox: questions attendees send from an event page, and the
 * conversations that follow. Two homes:
 *
 * - the organizer Messages TAB (`asTab`): every event, big serif title, no back;
 * - pushed from one event (OrganizerMessages with `eventId`): that event only,
 *   with the standard back header.
 *
 * Laid out like a messaging app rather than a card stack: the person's photo
 * (or the house silhouette) with the event's poster tucked into its corner,
 * name and time on one line, the last message under it. "Needs reply" is the
 * default view whenever anything is waiting, because somebody asking "is this
 * legit?" is a sale waiting on an answer. Opening a row pushes the shared
 * conversation screen (MessageThread), which both sides use.
 *
 * Reads go through our API, never Firestore: replies are server-only.
 */
export default function OrganizerMessagesScreen({ asTab = false }: { asTab?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerMessages'>>();
  const navigation = useNavigation<any>();
  const eventId = asTab ? undefined : route.params?.eventId;
  const eventTitle = asTab ? undefined : route.params?.eventTitle;
  const initialThread = asTab ? undefined : route.params?.thread;
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const insets = useSafeAreaInsets();
  const tabBarSpace = useTabBarSpace();
  const { t, language } = useI18n();
  const { user } = useAuth();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [segment, setSegment] = useState<'waiting' | 'all' | null>(null);
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  // Event page only: one-to-one questions vs one-to-many announcements.
  const [pane, setPane] = useState<'questions' | 'announcements'>('questions');

  const load = useCallback(async () => {
    try {
      const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
      const res = await backendJson<{ threads: Thread[] }>(`/api/organizer/messages${qs}`);
      setThreads(res?.threads || []);
      setFailed(false);
    } catch (e) {
      console.warn('Failed to load organizer messages', e);
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Keep the tab badge in step with what this list shows.
    refreshOrganizerUnread();
  }, [eventId]);

  // Refetch on every focus: coming back from a conversation moves it to
  // "answered" and clears its dot.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A push or email that names a thread: go straight into it, once.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialThread) return;
    openedInitial.current = true;
    navigation.navigate('MessageThread', { threadId: initialThread });
  }, [initialThread, navigation]);

  const inboxEvents = useMemo(() => {
    if (eventId) return [];
    const seen = new Map<string, string>();
    for (const th of threads) if (th.event_id && !seen.has(th.event_id)) seen.set(th.event_id, th.event_title || '');
    return seen.size > 1 ? Array.from(seen, ([id, title]) => ({ id, title })) : [];
  }, [threads, eventId]);

  const scoped = useMemo(
    () => (eventFilter ? threads.filter((th) => th.event_id === eventFilter) : threads),
    [threads, eventFilter],
  );
  const waiting = useMemo(() => scoped.filter(needsReply), [scoped]);
  // Until the organizer picks, open on "Needs reply" whenever something waits.
  const activeSegment = segment ?? (waiting.length > 0 ? 'waiting' : 'all');
  const shown = activeSegment === 'waiting' ? waiting : scoped;

  const open = (thread: Thread) => {
    setThreads((prev) => prev.map((th) => (th.id === thread.id ? { ...th, unread: false } : th)));
    navigation.navigate('MessageThread', { threadId: thread.id, eventTitle: thread.event_title });
  };

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const timeLabels = { yesterday: t('attendeeMessages.yesterday') };

  // ---- Header -------------------------------------------------------------
  const segments = (
    <View style={styles.segmentTrack} accessibilityRole="tablist">
      {(
        [
          { key: 'waiting', label: t('organizerMessages.segmentWaiting'), count: waiting.length },
          { key: 'all', label: t('organizerMessages.segmentAll'), count: scoped.length },
        ] as const
      ).map((s) => {
        const active = activeSegment === s.key;
        return (
          <TouchableOpacity
            key={s.key}
            style={[styles.segment, active && styles.segmentActive]}
            activeOpacity={0.7}
            onPress={() => {
              if (!active) hapticSelect();
              setSegment(s.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${s.label}, ${s.count}`}
          >
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.segmentLabelInactive]}>
              {s.label}
              {'  '}
              <Text style={[styles.segmentCount, s.key === 'waiting' && s.count > 0 && styles.segmentCountHot]}>
                {s.count}
              </Text>
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const eventRail =
    inboxEvents.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRail}
        contentContainerStyle={styles.filterRow}
      >
        {[{ id: null as string | null, title: t('organizerMessages.allEvents') }, ...inboxEvents].map((ev) => {
          const active = eventFilter === ev.id;
          return (
            <Touchable
              key={ev.id ?? 'all'}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                if (!active) hapticSelect();
                setEventFilter(ev.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t('organizerMessages.filterA11y').replace('{event}', ev.title)}
            >
              <Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>
                {ev.title}
              </Text>
            </Touchable>
          );
        })}
      </ScrollView>
    ) : null;

  // ---- Rows ---------------------------------------------------------------
  const renderRow = (thread: Thread) => {
    const last = thread.replies[thread.replies.length - 1];
    const lastText = last ? last.body : thread.message;
    const lastFromTeam = last ? last.author_role !== 'attendee' : false;
    // "You:" for your own last reply, "Marie:" for a teammate's.
    const lastBy =
      lastFromTeam && last
        ? last.author_id && user?.uid && last.author_id !== user.uid && last.sent_by
          ? last.sent_by
          : t('organizerMessages.you')
        : '';
    const waitingOnMe = needsReply(thread);
    const unread = thread.unread;
    return (
      <Touchable
        key={thread.id}
        scale={0.985}
        style={styles.row}
        onPress={() => open(thread)}
        accessibilityRole="button"
        accessibilityLabel={`${thread.sender_name}, ${thread.event_title}. ${lastText}`}
      >
        <View style={styles.avatarWrap}>
          <Image
            source={thread.sender_photo ? { uri: thread.sender_photo } : defaultAvatar(thread.id)}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityIgnoresInvertColors
          />
          {!eventId && (
            <View style={styles.posterBadge}>
              {thread.event_poster ? (
                <Image
                  source={{ uri: thread.event_poster }}
                  style={styles.posterImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.posterImg, { backgroundColor: colors.surfaceRaised }]} />
              )}
            </View>
          )}
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
              {thread.sender_name}
            </Text>
            <Text style={[styles.time, unread && styles.timeUnread]}>
              {inboxTime(thread.last_activity_at, language, timeLabels)}
            </Text>
          </View>

          <View style={styles.previewRow}>
            <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
              {lastBy ? <Text style={styles.previewYou}>{lastBy}: </Text> : null}
              {lastText}
            </Text>
            {unread ? <View style={styles.unreadDot} accessibilityLabel={t('attendeeMessages.newReply')} /> : null}
          </View>

          <View style={styles.metaRow}>
            {waitingOnMe && activeSegment === 'all' ? (
              // Dot + label, never a filled pill (house rule). Only in "All":
              // inside "Needs reply" every row would say it.
              <View style={styles.needsReply}>
                <View style={styles.needsReplyDot} />
                <Text style={styles.needsReplyText}>{t('organizerMessages.needsReply')}</Text>
              </View>
            ) : null}
            {!eventId ? (
              <Text style={styles.meta} numberOfLines={1}>
                {waitingOnMe && activeSegment === 'all' ? '·  ' : ''}
                {thread.event_title}
              </Text>
            ) : null}
          </View>
        </View>
      </Touchable>
    );
  };

  // ---- Body ---------------------------------------------------------------
  const skeleton = (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={AVATAR} height={AVATAR} radius={AVATAR / 2} />
          <View style={[styles.rowBody, { gap: 9, paddingTop: 4 }]}>
            <View style={styles.rowTop}>
              <Skeleton width="42%" height={15} radius={radius.sm} />
              <Skeleton width={40} height={11} radius={radius.sm} />
            </View>
            <Skeleton width="92%" height={13} radius={radius.sm} />
            <Skeleton width="55%" height={11} radius={radius.sm} />
          </View>
        </View>
      ))}
    </View>
  );

  const body = loading ? (
    skeleton
  ) : failed && threads.length === 0 ? (
    <View style={styles.emptyWrap}>
      <EmptyState icon={MessageSquare} title={t('organizerMessages.loadFailed')} />
    </View>
  ) : threads.length === 0 ? (
    <View style={styles.panelWrap}>
      <EmptyState
        variant="panel"
        icon={MessageSquare}
        title={t('organizerMessages.empty')}
      />
    </View>
  ) : shown.length === 0 ? (
    <View style={styles.emptyWrap}>
      <EmptyState
        icon={MessageSquare}
        title={t('organizerMessages.caughtUpTitle')}
        subtitle={t('organizerMessages.caughtUpBody')}
        compact
      />
    </View>
  ) : (
    <View style={styles.list}>{shown.map(renderRow)}</View>
  );

  // Questions (one-to-one) | Announcements (bulk + automatic), owner 2026-11-18.
  const paneTabs = (
    <View style={styles.segmentTrack} accessibilityRole="tablist">
      {(['questions', 'announcements'] as const).map((k) => {
        const active = pane === k;
        return (
          <TouchableOpacity
            key={k}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => {
              hapticSelect();
              setPane(k);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : styles.segmentLabelInactive]}>
              {k === 'questions'
                ? t('organizerMessages.tabQuestions')
                : t('organizerMessages.tabAnnouncements')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const showSegments = !loading && threads.length > 0;

  if (asTab) {
    return (
      <View style={styles.container}>
        <View style={[styles.tabHeader, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.tabTitle} accessibilityRole="header">
            {t('organizerMessages.title').toLowerCase()}
          </Text>
          {paneTabs}
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: tabBarSpace + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
          }
        >
          {pane === 'announcements' ? (
            <View style={{ paddingTop: 12 }}>
              <OrgAnnouncements />
            </View>
          ) : (
            <>
              {showSegments ? <View style={[styles.stackSegments, { marginTop: 12 }]}>{segments}</View> : null}
              {showSegments ? eventRail : null}
              {body}
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('organizerMessages.title')}
        subtitle={eventTitle || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: headerH + 4, paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {/* Event page: Questions (one-to-one) and Announcements (bulk
            messages + the automatic reminders), owner 2026-11-18. */}
        {eventId ? <View style={[styles.stackSegments, { marginBottom: 12 }]}>{paneTabs}</View> : null}
        {eventId && pane === 'announcements' ? (
          <EventAnnouncements eventId={eventId} eventTitle={eventTitle || ''} />
        ) : (
          <>
            {showSegments ? <View style={styles.stackSegments}>{segments}</View> : null}
            {body}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** The Messages tab of the organizer bar. */
export function OrganizerInboxTab() {
  return <OrganizerMessagesScreen asTab />;
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },

    // Same header as the Events tab: big serif title, underline segments.
    tabHeader: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: colors.background },
    tabTitle: {
      fontFamily: font.serif,
      fontSize: 26,
      lineHeight: 32,
      color: colors.text,
      marginBottom: 12,
    },
    stackSegments: { paddingHorizontal: 16, marginBottom: 8 },
    segmentTrack: {
      flexDirection: 'row',
      gap: 24,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    segment: {
      paddingTop: 4,
      paddingBottom: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      marginBottom: -StyleSheet.hairlineWidth,
    },
    segmentActive: { borderBottomColor: colors.text },
    segmentLabel: { fontSize: 15, fontVariant: ['tabular-nums'] },
    segmentLabelActive: { color: colors.text, fontWeight: '600' },
    segmentLabelInactive: { color: colors.textSecondary, fontWeight: '500' },
    segmentCount: { color: colors.textSecondary, fontWeight: '400' },
    segmentCountHot: { color: colors.primary, fontWeight: '600' },

    // Quiet filter: small fills that sit under the segments, not a second
    // row of buttons competing with them.
    filterRail: { marginTop: 14, marginBottom: 2 },
    filterRow: { paddingHorizontal: 16, gap: 6 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.chip,
      backgroundColor: colors.surface,
      maxWidth: 200,
    },
    chipActive: { backgroundColor: colors.white },
    chipText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, color: colors.textSecondary },
    chipTextActive: { color: T.onWhite },

    // Rows: no card fill, separated by rhythm, never a hairline.
    list: { paddingHorizontal: 16, paddingTop: 12 },
    row: { flexDirection: 'row', gap: 14, paddingVertical: 12 },
    avatarWrap: { width: AVATAR, height: AVATAR },
    avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.surfaceRaised },
    // The event's poster tucked into the avatar's corner, ringed in the page
    // colour so it reads as a separate object.
    posterBadge: {
      position: 'absolute',
      right: -6,
      bottom: -4,
      padding: 2,
      borderRadius: radius.poster + 2,
      backgroundColor: colors.background,
    },
    posterImg: { width: POSTER_W, height: POSTER_H, borderRadius: radius.poster },
    rowBody: { flex: 1, minWidth: 0 },
    rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    name: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.text },
    nameUnread: { fontWeight: '700' },
    time: { fontSize: 12, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
    timeUnread: { color: colors.primary, fontWeight: '600' },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 },
    preview: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
    previewUnread: { color: colors.text },
    previewYou: { color: colors.textTertiary },
    unreadDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.primary },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textTertiary },
    needsReply: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    needsReplyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
    needsReplyText: { fontSize: 12, fontWeight: '600', color: colors.warning },

    emptyWrap: { paddingTop: 48, paddingHorizontal: 24 },
    panelWrap: { paddingTop: 8, paddingHorizontal: 16 },
    broadcastWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  });
