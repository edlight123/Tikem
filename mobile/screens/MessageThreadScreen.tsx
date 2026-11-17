import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowUp, MessageCircle } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import { backendJson } from '../lib/api/backend';
import { clockTime, dayLabel, sameDay } from '../lib/messageTime';
import { defaultAvatar } from '../lib/defaultAvatar';
import { refreshAttendeeUnread } from '../lib/attendeeUnread';
import { refreshOrganizerUnread } from '../lib/organizerUnread';
import { colors as T, font, radius } from '../theme/tokens';
import { Touchable } from '../components/ui/Touchable';

/** Mirrors MAX_FOLLOWUP_LENGTH / MAX_REPLY_LENGTH in lib/organizer-messages.ts. */
const MAX_ATTENDEE_LENGTH = 1000;
const MAX_ORGANIZER_LENGTH = 2000;

type Message = {
  id: string;
  body: string;
  author_role: 'attendee' | 'organizer';
  author_name: string;
  created_at: string | null;
  /** Organizer side only: the teammate who wrote it (never sent to attendees). */
  author_id?: string;
  sent_by?: string;
};

/** GET /api/messages/[id] (lib/organizer-messages ConversationView). */
type Conversation = {
  id: string;
  event_id: string;
  event_title: string;
  event_poster: string | null;
  topic: string;
  viewer_role: 'attendee' | 'organizer';
  attendee_name: string;
  organizer_name: string;
  needs_reply: boolean;
  reply_count: number;
  closed: boolean;
  awaiting_organizer: boolean;
  messages: Message[];
  /** The other side's public profile photo. */
  other_photo?: string | null;
};

/** Messages from one author this close together read as one run. */
const RUN_GAP_MS = 5 * 60 * 1000;

/**
 * One attendee ↔ organizer conversation: the opening question, the organizer's
 * replies and the attendee's follow-ups, in order, with a box pinned at the
 * bottom to write back into the SAME thread.
 *
 * Opened from Messages, from the "organizer replied" notification and from the
 * reply push (tikem://messages/<id>). Either participant can land here: the
 * server says which side the viewer is on (`viewer_role`), "mine" sits on the
 * right, and an organizer's send goes to the organizer reply route.
 */
export default function MessageThreadScreen({ navigation, route }: any) {
  const threadId: string = route?.params?.threadId;
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const scrollRef = useRef<ScrollView>(null);

  const [thread, setThread] = useState<Conversation | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!threadId) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await backendJson<{ thread: Conversation }>(`/api/messages/${encodeURIComponent(threadId)}`);
      setThread(res.thread);
      setStatus('ready');
      // Best-effort: a failed acknowledgement only means the dot returns next load.
      // The tab badges follow once the server has the acknowledgement.
      const role = res.thread?.viewer_role;
      backendJson(`/api/messages/${encodeURIComponent(threadId)}/read`, { method: 'POST' })
        .then(() => (role === 'organizer' ? refreshOrganizerUnread() : refreshAttendeeUnread()))
        .catch(() => {});
    } catch (e) {
      console.warn('Failed to load conversation', e);
      setStatus('error');
    }
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  const dayLabels = { today: t('attendeeMessages.today'), yesterday: t('attendeeMessages.yesterday') };

  const isOrganizer = thread?.viewer_role === 'organizer';
  const maxLength = isOrganizer ? MAX_ORGANIZER_LENGTH : MAX_ATTENDEE_LENGTH;
  const otherName = isOrganizer
    ? thread?.attendee_name || ''
    : thread?.organizer_name || t('attendeeMessages.organizer');
  // An organizer is never held by the attendee streak; the thread cap binds both.
  const blocked = !thread || thread.closed || (!isOrganizer && thread.awaiting_organizer);

  const send = async () => {
    const body = draft.trim();
    if (!thread || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const path = isOrganizer
        ? `/api/organizer/messages/${encodeURIComponent(thread.id)}/reply`
        : `/api/messages/${encodeURIComponent(thread.id)}/reply`;
      const res = await backendJson<{ reply: Message }>(path, {
        method: 'POST',
        body: JSON.stringify({ message: body }),
      });
      const saved: Message = res?.reply ?? {
        id: `local-${Date.now()}`,
        body,
        author_role: thread.viewer_role,
        author_name: '',
        created_at: new Date().toISOString(),
      };
      setThread((th) =>
        th ? { ...th, reply_count: th.reply_count + 1, messages: [...th.messages, saved] } : th,
      );
      setDraft('');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      // The server's message is English prose meant for logs; localize off the code.
      const code = e?.code as string | undefined;
      if (code === 'awaiting_reply') setThread((th) => (th ? { ...th, awaiting_organizer: true } : th));
      if (code === 'thread_reply_limit') setThread((th) => (th ? { ...th, closed: true } : th));
      setError(
        code === 'awaiting_reply'
          ? t('attendeeMessages.errorAwaiting')
          : code === 'thread_reply_limit'
            ? t('attendeeMessages.errorLimit')
            : code === 'message_too_long'
              ? t('attendeeMessages.errorTooLong')
              : t('attendeeMessages.errorGeneric'),
      );
    } finally {
      setSending(false);
    }
  };

  // The person is the title; the event is the context under it.
  const title = otherName || thread?.event_title || route?.params?.eventTitle || t('attendeeMessages.title');
  const subtitle = thread?.event_title || route?.params?.eventTitle || '';
  const topicLabel = (topic: string) =>
    topic === 'event'
      ? t('organizerMessages.aboutEvent')
      : topic === 'ticket'
        ? t('organizerMessages.aboutTicket')
        : t('organizerMessages.aboutOther');
  const hasOrganizerReply = !!thread?.messages.some((m) => m.author_role === 'organizer');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header}>
        <Touchable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </Touchable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && subtitle !== title ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.backButton}>
          {thread ? (
            <Image
              source={thread.other_photo ? { uri: thread.other_photo } : defaultAvatar(thread.id)}
              style={styles.headerAvatar}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>
      </OverlayHeader>

      {status === 'loading' ? (
        // Mirrors the loaded layout: event card, a day label, their bubble,
        // then mine, so nothing jumps when the conversation arrives.
        <View style={{ paddingTop: headerH + 12, paddingHorizontal: 16 }}>
          <View style={styles.eventRow}>
            <Skeleton width={44} height={55} radius={radius.poster} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="70%" height={17} radius={radius.sm} />
              <Skeleton width="40%" height={12} radius={radius.sm} />
            </View>
          </View>
          <Skeleton width={64} height={11} radius={radius.sm} style={{ alignSelf: 'center', marginBottom: 14 }} />
          <Skeleton width="78%" height={66} radius={radius.md} style={{ marginBottom: 6 }} />
          <Skeleton width={56} height={10} radius={radius.sm} style={{ marginBottom: 16 }} />
          <Skeleton width="58%" height={44} radius={radius.md} style={{ alignSelf: 'flex-end', marginBottom: 6 }} />
          <Skeleton width={56} height={10} radius={radius.sm} style={{ alignSelf: 'flex-end' }} />
        </View>
      ) : status === 'error' || !thread ? (
        <View style={[styles.emptyWrap, { paddingTop: headerH }]}>
          <EmptyState icon={MessageCircle} title={t('attendeeMessages.threadFailed')} />
          <Touchable style={styles.retry} onPress={load} accessibilityRole="button">
            <Text style={styles.retryText}>{t('attendeeMessages.retry')}</Text>
          </Touchable>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 16, paddingTop: headerH + 12, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            <Touchable
              style={styles.eventRow}
              onPress={() => navigation.navigate('EventDetail', { eventId: thread.event_id })}
              scale={0.98}
              accessibilityRole="button"
              accessibilityLabel={thread.event_title}
            >
              {thread.event_poster ? (
                <Image source={{ uri: thread.event_poster }} style={styles.poster} contentFit="cover" />
              ) : (
                <View style={[styles.poster, styles.posterFallback]} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.eventTitle} numberOfLines={2}>
                  {thread.event_title}
                </Text>
                <Text style={styles.eventSub} numberOfLines={1}>
                  {isOrganizer ? topicLabel(thread.topic) : otherName}
                </Text>
              </View>
            </Touchable>

            {thread.messages.map((m, i) => {
              const prev = thread.messages[i - 1];
              const next = thread.messages[i + 1];
              // "Our side" (right) is by role; WHO on the team wrote it is a
              // label only the team sees: "You", or the teammate's first name.
              const mine = m.author_role === thread.viewer_role;
              const byTeammate = mine && isOrganizer && !!m.author_id && !!user?.uid && m.author_id !== user.uid;
              const newDay = !prev || !sameDay(prev.created_at, m.created_at);
              const gap = (a?: Message, b?: Message) =>
                !!a && !!b && !!a.created_at && !!b.created_at
                  ? Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at))
                  : Infinity;
              // Same author, same day, minutes apart: one run. Time goes under
              // the run's last bubble only.
              const joinsPrev = !newDay && !!prev && prev.author_role === m.author_role && gap(prev, m) < RUN_GAP_MS;
              const endsRun =
                !next ||
                next.author_role !== m.author_role ||
                !sameDay(m.created_at, next.created_at) ||
                gap(m, next) >= RUN_GAP_MS;
              return (
                <View key={m.id}>
                  {newDay ? <Text style={styles.dayLabel}>{dayLabel(m.created_at, language, dayLabels)}</Text> : null}
                  <View
                    style={[
                      styles.bubbleRow,
                      mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
                      joinsPrev && styles.bubbleRowJoined,
                    ]}
                  >
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                    </View>
                  </View>
                  {endsRun ? (
                    <Text style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}>
                      {byTeammate
                        ? m.sent_by || thread.organizer_name || m.author_name
                        : mine
                          ? t('attendeeMessages.you')
                          : m.author_name || otherName}
                      {'  ·  '}
                      {clockTime(m.created_at, language)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.composer, { paddingBottom: 10 + insets.bottom }]}>
            {thread.closed ? (
              <Text style={styles.composerNote}>{t('attendeeMessages.closed')}</Text>
            ) : !isOrganizer && thread.awaiting_organizer ? (
              <Text style={styles.composerNote}>{t('attendeeMessages.awaiting')}</Text>
            ) : null}
            {isOrganizer && !hasOrganizerReply && !thread.closed ? (
              <Text style={styles.composerNote}>
                {t('attendeeMessages.deliveredNote').replace('{name}', otherName)}
              </Text>
            ) : null}
            {!!error && <Text style={styles.errorText}>{error}</Text>}
            {!blocked && (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={(v) => setDraft(v.slice(0, maxLength))}
                  placeholder={t('attendeeMessages.placeholder').replace('{name}', otherName)}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  multiline
                  maxLength={maxLength}
                  editable={!sending}
                  accessibilityLabel={t('attendeeMessages.replyLabel')}
                />
                <Touchable
                  style={[styles.sendButton, !sending && !draft.trim() && styles.sendButtonDisabled]}
                  onPress={send}
                  disabled={sending || !draft.trim()}
                  accessibilityRole="button"
                  accessibilityLabel={t('attendeeMessages.send')}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={T.onWhite} />
                  ) : (
                    <ArrowUp size={20} color={draft.trim() ? T.onWhite : colors.textTertiary} strokeWidth={2.25} />
                  )}
                </Touchable>
              </View>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 8 },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerCenter: { flex: 1, alignItems: 'center', minWidth: 0 },
    headerTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.text },
    headerSubtitle: { marginTop: 1, fontSize: 12, lineHeight: 16, color: colors.textTertiary },
    headerAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceRaised },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    retry: {
      marginTop: 20,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
    },
    retryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      marginBottom: 20,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    poster: { width: 44, height: 55, borderRadius: radius.poster, backgroundColor: colors.surfaceRaised },
    posterFallback: {},
    eventTitle: { fontFamily: font.serif, fontSize: 18, lineHeight: 22, color: colors.text },
    eventSub: { marginTop: 3, fontSize: 13, color: colors.textSecondary },
    dayLabel: {
      alignSelf: 'center',
      marginTop: 4,
      marginBottom: 12,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    bubbleRow: { flexDirection: 'row', marginTop: 10 },
    bubbleRowJoined: { marginTop: 3 },
    bubbleRowMine: { justifyContent: 'flex-end' },
    bubbleRowTheirs: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '82%', borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
    // Mine: solid white with black text, the app's primary-action pairing.
    // Theirs: the raised dark fill. Fills, never hairlines.
    bubbleMine: { backgroundColor: T.white },
    bubbleTheirs: { backgroundColor: colors.surfaceRaised },
    bubbleText: { fontSize: 15, lineHeight: 21, color: colors.text },
    bubbleTextMine: { color: T.onWhite },
    bubbleMeta: { marginTop: 5, marginBottom: 4, fontSize: 11, color: colors.textTertiary },
    bubbleMetaMine: { alignSelf: 'flex-end' },
    composer: { paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.background },
    composerNote: { fontSize: 12, lineHeight: 17, color: colors.textTertiary, marginBottom: 8, paddingHorizontal: 4 },
    errorText: { fontSize: 13, color: colors.error, marginBottom: 8, paddingHorizontal: 4 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 140,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 15,
      color: colors.text,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: radius.button,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Empty draft: a quiet raised square, not a faded white one.
    sendButtonDisabled: { backgroundColor: colors.surfaceRaised },
  });
