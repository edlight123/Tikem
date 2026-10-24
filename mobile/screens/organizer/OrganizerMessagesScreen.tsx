import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { MessageSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from '../../components/AppAlert';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { backendJson } from '../../lib/api/backend';
import { safeFormatForLanguage } from '../../lib/dates';

type RouteParams = {
  OrganizerMessages: {
    /** Omit for the organizer's whole inbox; pass to scope to one event. */
    eventId?: string;
    eventTitle?: string;
    /** Open this conversation on arrival (the "new message" push and email). */
    thread?: string;
  } | undefined;
};

/** Mirrors MAX_REPLY_LENGTH in lib/organizer-messages.ts — the server rejects more. */
const MAX_REPLY_LENGTH = 2000;

type Reply = {
  id: string;
  body: string;
  /** 'attendee' = a follow-up from the person who asked; older replies are all 'organizer'. */
  author_role?: 'attendee' | 'organizer';
  author_name: string;
  created_at: string | null;
};

type Thread = {
  id: string;
  event_id: string;
  event_title: string;
  sender_name: string;
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

const needsReply = (th: Thread) =>
  typeof th.needs_reply === 'boolean' ? th.needs_reply : th.reply_count === 0;

/**
 * The organizer's side of attendee messaging: read the questions people send
 * before buying and answer them. Somebody asking "is this real?" is a sale
 * waiting on a reply, so the threads waiting on the organizer (a new question,
 * or a follow-up after their answer) sort to the top under their own heading.
 * Attendee follow-ups appear in the conversation on the left, the organizer's
 * own replies on the right.
 *
 * Reads and writes go through our API, never Firestore directly —
 * `organizer_messages` replies are server-only by design (see firestore.rules).
 */
export default function OrganizerMessagesScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerMessages'>>();
  const navigation = useNavigation<any>();
  const eventId = route.params?.eventId;
  const eventTitle = route.params?.eventTitle;
  const initialThread = route.params?.thread;
  const openedInitial = React.useRef(false);
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const insets = useSafeAreaInsets();

  const { t, language } = useI18n();
  const showAlert = useAppAlert();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
      const res = await backendJson<{ threads: Thread[] }>(`/api/organizer/messages${qs}`);
      setThreads(res?.threads || []);
    } catch (e) {
      console.error('Failed to load organizer messages', e);
      showAlert(t('common.error'), t('organizerMessages.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const open = useMemo(() => threads.find((th) => th.id === openId) ?? null, [threads, openId]);
  const waiting = useMemo(() => threads.filter(needsReply), [threads]);
  const answered = useMemo(() => threads.filter((th) => !needsReply(th)), [threads]);

  const topicLabel = (topic: string) => {
    if (topic === 'event') return t('organizerMessages.aboutEvent');
    if (topic === 'ticket') return t('organizerMessages.aboutTicket');
    return t('organizerMessages.aboutOther');
  };

  const when = (iso: string | null) =>
    iso ? safeFormatForLanguage(iso, 'MMM dd, yyyy h:mm a', language) : '';

  /** Opening a thread is acknowledging it — the question is on screen. */
  const handleOpen = async (thread: Thread) => {
    setOpenId(thread.id);
    setReply('');
    setError(null);
    if (!thread.unread) return;
    setThreads((prev) =>
      prev.map((th) => (th.id === thread.id ? { ...th, unread: false } : th))
    );
    try {
      await backendJson(`/api/organizer/messages/${thread.id}/read`, { method: 'POST' });
    } catch {
      // The badge is a convenience, not a record: a failed acknowledgement just
      // means the thread reads as unread again after the next refresh.
    }
  };

  // Arriving from a push or email that names a thread: open it once loaded.
  useEffect(() => {
    if (openedInitial.current || loading || !initialThread) return;
    const target = threads.find((th) => th.id === initialThread);
    if (target) {
      openedInitial.current = true;
      handleOpen(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, threads, initialThread]);

  const handleSend = async () => {
    if (!open) return;
    const body = reply.trim();
    if (!body) {
      setError(t('organizerMessages.errorEmpty'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await backendJson<{ ok: boolean; reply: Reply }>(
        `/api/organizer/messages/${open.id}/reply`,
        { method: 'POST', body: JSON.stringify({ message: body }) }
      );
      const saved: Reply =
        res?.reply ?? {
          id: `local-${Date.now()}`,
          body,
          author_role: 'organizer',
          author_name: t('organizerMessages.you'),
          created_at: new Date().toISOString(),
        };
      const threadId = open.id;
      setThreads((prev) =>
        prev.map((th) =>
          th.id === threadId
            ? {
                ...th,
                status: 'replied',
                needs_reply: false,
                unread: false,
                reply_count: th.reply_count + 1,
                last_activity_at: saved.created_at,
                replies: [...th.replies, saved],
              }
            : th
        )
      );
      setReply('');
      showAlert(
        t('organizerMessages.sentTitle'),
        t('organizerMessages.sentBody').replace('{name}', open.sender_name)
      );
    } catch (e: any) {
      // The server's message is English prose meant for logs, so localize off
      // the code and keep the raw text as the last resort.
      const code = e?.code as string | undefined;
      const message =
        code === 'thread_reply_limit'
          ? t('organizerMessages.errorReplyLimit')
          : code === 'message_too_long'
            ? t('organizerMessages.errorTooLong')
            : t('organizerMessages.errorGeneric');
      setError(message);
      showAlert(t('common.error'), message);
    } finally {
      setSending(false);
    }
  };

  const headerTitle = t('organizerMessages.title');
  const headerSubtitle = open
    ? open.sender_name
    : eventTitle ||
      // "Waiting on you" counts UNANSWERED threads, not merely unopened ones —
      // reading a question without answering it does not clear the debt.
      (waiting.length > 0
        ? t('organizerMessages.waitingCount').replace('{count}', String(waiting.length))
        : undefined);

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump. */}
        <OrganizerScreenHeader
          title={headerTitle}
          subtitle={eventTitle || undefined}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}>
          <Skeleton width={160} height={22} radius={4} style={{ marginBottom: 14 }} />
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardHead}>
                <Skeleton width="45%" height={15} radius={4} />
                <Skeleton width={90} height={11} radius={4} />
              </View>
              <Skeleton width="100%" height={13} radius={4} style={{ marginTop: 10 }} />
              <Skeleton width="70%" height={13} radius={4} style={{ marginTop: 6 }} />
              <Skeleton width={120} height={11} radius={4} style={{ marginTop: 10 }} />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ---- One conversation -----------------------------------------------------
  if (open) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <OrganizerScreenHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          onBack={() => setOpenId(null)}
          overlay
          onHeight={onHeight}
        />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* The heading is the label, not the person: SectionHeader lowercases
              its title by design, which is right for an eyebrow and wrong for
              somebody's name. The name sits in the screen header instead. */}
          <SectionHeader
            title={t('organizerMessages.questionHeading')}
            subtitle={`${topicLabel(open.topic)} · ${when(open.created_at)}`}
          />

          <View style={styles.bubbleThem}>
            <Text style={styles.bubbleThemText}>{open.message}</Text>
          </View>

          {open.replies.map((r) =>
            r.author_role === 'attendee' ? (
              // A follow-up from the attendee: their side, with their name.
              <View key={r.id} style={styles.bubbleThem}>
                <Text style={styles.bubbleThemText}>{r.body}</Text>
                <Text style={styles.bubbleMeta}>
                  {open.sender_name} · {when(r.created_at)}
                </Text>
              </View>
            ) : (
              <View key={r.id} style={styles.bubbleMineWrap}>
                <View style={styles.bubbleMine}>
                  <Text style={styles.bubbleMineText}>{r.body}</Text>
                  <Text style={styles.bubbleMeta}>
                    {t('organizerMessages.you')} · {when(r.created_at)}
                  </Text>
                </View>
              </View>
            )
          )}

          <View style={styles.composer}>
            <SectionHeader title={t('organizerMessages.replyHeading')} />
            <TextInput
              style={styles.input}
              value={reply}
              onChangeText={(v) => setReply(v.slice(0, MAX_REPLY_LENGTH))}
              placeholder={t('organizerMessages.replyPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              multiline
              textAlignVertical="top"
              maxLength={MAX_REPLY_LENGTH}
              editable={!sending}
            />
            <Text style={styles.counter}>
              {reply.length}/{MAX_REPLY_LENGTH}
            </Text>

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <WhitePillCTA
              label={sending ? t('organizerMessages.sending') : t('organizerMessages.send')}
              onPress={handleSend}
              loading={sending}
              disabled={sending || reply.trim().length === 0}
              style={styles.submit}
            />
            <Text style={styles.privacyNote}>{t('organizerMessages.privacyNote')}</Text>
          </View>

          <View style={{ height: 40 + insets.bottom }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ---- Inbox ----------------------------------------------------------------
  const renderCard = (thread: Thread) => {
    const last = thread.replies[thread.replies.length - 1];
    const lastText = last ? last.body : thread.message;
    const lastFromMe = last ? last.author_role !== 'attendee' : false;
    return (
    <TouchableOpacity
      key={thread.id}
      style={styles.card}
      onPress={() => handleOpen(thread)}
      accessibilityRole="button"
      accessibilityLabel={`${thread.sender_name}: ${thread.message}`}
    >
      <View style={styles.cardHead}>
        <View style={styles.cardHeadLeft}>
          {thread.unread && <View style={styles.unreadDot} />}
          <Text style={styles.cardName} numberOfLines={1}>
            {thread.sender_name}
          </Text>
        </View>
        <Text style={styles.cardWhen}>{when(thread.last_activity_at)}</Text>
      </View>
      <Text style={styles.cardMessage} numberOfLines={2}>
        {lastFromMe ? `${t('organizerMessages.you')}: ` : ''}
        {lastText}
      </Text>
      <View style={styles.cardMetaRow}>
        {needsReply(thread) ? (
          // Dot + label, never a filled pill (house rule).
          <View style={styles.needsReply}>
            <View style={styles.needsReplyDot} />
            <Text style={styles.needsReplyText}>{t('organizerMessages.needsReply')}</Text>
          </View>
        ) : null}
        <Text style={[styles.cardMeta, styles.cardMetaFlex]} numberOfLines={1}>
          {topicLabel(thread.topic)}
          {!eventId && thread.event_title ? ` · ${thread.event_title}` : ''}
          {!needsReply(thread) ? ` · ${t('organizerMessages.answered')}` : ''}
        </Text>
      </View>
    </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {threads.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t('organizerMessages.empty')}
            subtitle={t('organizerMessages.emptySubtitle')}
          />
        ) : (
          <>
            {waiting.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('organizerMessages.sectionWaiting')} />
                {waiting.map(renderCard)}
              </View>
            )}
            {answered.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={t('organizerMessages.sectionAnswered')} />
                {answered.map(renderCard)}
              </View>
            )}
          </>
        )}
        <View style={{ height: 40 + insets.bottom }} />
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    section: {
      marginTop: 8,
      marginBottom: 20,
    },
    // Fill, not a hairline (house rule).
    card: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      padding: 14,
      marginBottom: 10,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    cardHeadLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    cardName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    cardWhen: {
      fontSize: 11,
      color: colors.textTertiary,
    },
    cardMessage: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    cardMetaRow: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cardMeta: {
      fontSize: 11,
      letterSpacing: 0.3,
      color: colors.textTertiary,
    },
    cardMetaFlex: {
      flexShrink: 1,
    },
    needsReply: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    needsReplyDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.warning,
    },
    needsReplyText: {
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.warning,
    },
    bubbleThem: {
      alignSelf: 'flex-start',
      maxWidth: '92%',
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      borderTopLeftRadius: radius.sm,
      padding: 14,
      marginBottom: 12,
    },
    bubbleThemText: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    bubbleMineWrap: {
      alignItems: 'flex-end',
    },
    bubbleMine: {
      maxWidth: '92%',
      backgroundColor: colors.surfaceRaised,
      borderRadius: RADIUS.xl,
      borderTopRightRadius: radius.sm,
      padding: 14,
      marginBottom: 12,
    },
    bubbleMineText: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    bubbleMeta: {
      marginTop: 8,
      fontSize: 11,
      color: colors.textTertiary,
    },
    composer: {
      marginTop: 20,
    },
    input: {
      minHeight: 120,
      backgroundColor: colors.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
    },
    counter: {
      alignSelf: 'flex-end',
      marginTop: 6,
      fontSize: 11,
      color: colors.textTertiary,
    },
    errorText: {
      marginTop: 10,
      fontSize: 13,
      color: colors.error,
    },
    submit: {
      marginTop: 16,
    },
    privacyNote: {
      marginTop: 12,
      fontSize: 11,
      lineHeight: 16,
      textAlign: 'center',
      color: colors.textTertiary,
    },
  });
