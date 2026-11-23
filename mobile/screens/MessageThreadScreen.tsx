import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// The gesture-handler ScrollView, so the bubbles' swipe-to-reply pan and the
// list's vertical scrolling negotiate natively (components/messages/SwipeToReply).
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowUp, MessageCircle } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import ReportContentModal from '../components/ReportContentModal';
import MessageActionsSheet, { type BubbleRect } from '../components/messages/MessageActionsSheet';
import ReactionPills from '../components/messages/ReactionPills';
import QuotedMessage from '../components/messages/QuotedMessage';
import ReplyPreview from '../components/messages/ReplyPreview';
import SwipeToReply from '../components/messages/SwipeToReply';
import HeartPop from '../components/messages/HeartPop';
import { isJumboEmoji } from '../components/messages/emoji';
import {
  QUICK_REACTION,
  emojiSafe,
  firstLine,
  toggleLocal,
  type MessageStrings,
  type Reaction,
  type ReactionSummary,
  type ReplyTo,
} from '../components/messages/types';
import { backendJson } from '../lib/api/backend';
import { canCopy as clipboardAvailable, copyText } from '../lib/clipboard';
import { clockTime, dayLabel, sameDay } from '../lib/messageTime';
import { defaultAvatar } from '../lib/defaultAvatar';
import { refreshAttendeeUnread } from '../lib/attendeeUnread';
import { refreshOrganizerUnread } from '../lib/organizerUnread';
import { tapLight, success as hapticSuccess } from '../lib/haptics';
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
  /** Counts per emoji and whether one is mine; never who reacted. */
  reactions?: ReactionSummary[];
  /** The message this one quotes (built server-side). */
  reply_to?: ReplyTo;
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
  /** The other side's uid: the attendee (a person) or the organization. */
  other_id?: string | null;
  /** Either side blocked the other: no new messages or reactions. */
  blocked?: boolean;
  /** ...and it was the viewer's own side. */
  blocked_by_viewer?: boolean;
};

/** Messages from one author this close together read as one run. */
const RUN_GAP_MS = 5 * 60 * 1000;
/** Within this many points of the end counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120;
/** How long "Copied" shows above the composer. */
const COPIED_MS = 1400;

const isLocal = (m: Message) => m.id.startsWith('local-');
/** One to three emoji on their own render large, without a bubble. Never with a quote: the quote needs the bubble. */
const isJumbo = (m: Message) => !m.reply_to && isJumboEmoji(m.body);

/** True while the keyboard is up (no home-indicator inset under the composer then). */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return up;
}

/**
 * One attendee ↔ organizer conversation: the opening question, the organizer's
 * replies and the attendee's follow-ups, in order, with a box pinned at the
 * bottom to write back into the SAME thread.
 *
 * Opened from Messages, from the "organizer replied" notification and from the
 * reply push (tikem://messages/<id>). Either participant can land here: the
 * server says which side the viewer is on (`viewer_role`), "mine" sits on the
 * right, and an organizer's send goes to the organizer reply route.
 *
 * On a bubble: swipe right to reply (the quote sits above the composer), hold
 * for the menu (reactions, Reply, Copy when this build has a clipboard, Report
 * on the other side's messages), double tap for a heart. A blocked thread
 * (either side) shows no composer, no swipe and no reactions; the server
 * refuses them anyway (lib/messages/blockGuard.ts).
 *
 * The gesture-handler root wraps THIS screen only: Tikra wrapped the whole app
 * and every tap stopped working on their store build (2026-11-22).
 */
export default function MessageThreadScreen({ navigation, route }: any) {
  const threadId: string = route?.params?.threadId;
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t, language } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardUp();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const scrollRef = useRef<ScrollView>(null);
  // Starts true so the first paint lands on the latest message.
  const nearBottom = useRef(true);
  const inputRef = useRef<TextInput>(null);

  const [thread, setThread] = useState<Conversation | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Long-press menu and the message being replied to.
  const [actionFor, setActionFor] = useState<{ message: Message; mine: boolean; rect: BubbleRect | null } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [reporting, setReporting] = useState(false);
  // The heart that pops on a double tap (keyed by n so it replays).
  const [pop, setPop] = useState<{ id: string; n: number } | null>(null);
  const [copied, setCopied] = useState(false);
  // Where each row sits, and where each quote ends inside its bubble, so a tap
  // on a quote can jump to the quoted message.
  const rowY = useRef<Record<string, number>>({});
  const quoteBottom = useRef<Record<string, number>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // Decided once: an OTA build never assumes a native clipboard (lib/clipboard).
  const copyAvailable = useMemo(() => clipboardAvailable(), []);

  const strings: MessageStrings = {
    reply: t('messageExtras.reply'),
    copy: t('messageExtras.copy'),
    report: t('messageExtras.report'),
    close: t('messageExtras.close'),
    cancelReply: t('messageExtras.cancelReply'),
    replyingTo: t('messageExtras.replyingTo'),
    react: t('messageExtras.react'),
    reactionCount: t('messageExtras.reactionCount'),
  };

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
  const isBlocked = !!thread?.blocked;
  // An organizer is never held by the attendee streak; the thread cap binds both.
  const cantWrite = !thread || thread.closed || isBlocked || (!isOrganizer && thread.awaiting_organizer);

  /** The name and photo open the other side's page: the attendee as a person, or the organization. */
  const openOtherProfile = () => {
    if (!thread?.other_id) return;
    navigation.navigate('OrganizerProfile', { organizerId: thread.other_id });
  };

  /** A 403 from any write: the thread is closed by a block from here on. */
  const markBlocked = (code?: string) => {
    if (code !== 'blocked' && code !== 'you_blocked') return false;
    setThread((th) => (th ? { ...th, blocked: true, blocked_by_viewer: code === 'you_blocked' } : th));
    setReplyingTo(null);
    return true;
  };

  const send = async () => {
    const body = draft.trim();
    if (!thread || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const path = isOrganizer
        ? `/api/organizer/messages/${encodeURIComponent(thread.id)}/reply`
        : `/api/messages/${encodeURIComponent(thread.id)}/reply`;
      const quoted = replyingTo && !isLocal(replyingTo) ? replyingTo : null;
      const res = await backendJson<{ reply: Message }>(path, {
        method: 'POST',
        body: JSON.stringify({ message: body, ...(quoted ? { reply_to_id: quoted.id } : {}) }),
      });
      const saved: Message = res?.reply ?? {
        id: `local-${Date.now()}`,
        body,
        author_role: thread.viewer_role,
        author_name: '',
        created_at: new Date().toISOString(),
        ...(quoted
          ? { reply_to: { id: quoted.id, excerpt: firstLine(quoted.body), author_role: quoted.author_role } }
          : {}),
      };
      setThread((th) =>
        th ? { ...th, reply_count: th.reply_count + 1, messages: [...th.messages, saved] } : th,
      );
      // The input stays live while sending, so only clear what was sent.
      setDraft((d) => (d.trim() === body ? '' : d));
      setReplyingTo(null);
      nearBottom.current = true;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      // The server's message is English prose meant for logs; localize off the code.
      const code = e?.code as string | undefined;
      if (markBlocked(code)) return;
      if (code === 'awaiting_reply') setThread((th) => (th ? { ...th, awaiting_organizer: true } : th));
      if (code === 'thread_reply_limit') setThread((th) => (th ? { ...th, closed: true } : th));
      if (code === 'reply_to_not_found') setReplyingTo(null);
      setError(
        code === 'reply_to_not_found'
          ? t('messageExtras.quoteGone')
          : code === 'awaiting_reply'
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

  /** Optimistic: flip it on screen now, then take the server's counts. */
  const react = async (messageId: string, emoji: Reaction) => {
    if (!thread || isBlocked || messageId.startsWith('local-')) return;
    const setReactions = (fn: (m: Message) => ReactionSummary[] | undefined) =>
      setThread((th) =>
        th ? { ...th, messages: th.messages.map((m) => (m.id === messageId ? { ...m, reactions: fn(m) } : m)) } : th,
      );
    const before = thread.messages.find((m) => m.id === messageId)?.reactions;
    setReactions((m) => toggleLocal(m.reactions, emoji));
    try {
      const res = await backendJson<{ reactions: ReactionSummary[] }>(
        `/api/messages/${encodeURIComponent(thread.id)}/react`,
        { method: 'POST', body: JSON.stringify({ message_id: messageId, emoji }) },
      );
      if (Array.isArray(res?.reactions)) setReactions(() => res.reactions);
    } catch (e: any) {
      setReactions(() => before);
      if (!markBlocked(e?.code)) setError(t('messageExtras.reactionFailed'));
    }
  };

  /** Swipe or menu "Reply": quote it above the composer and open the keyboard. */
  const startReply = (m: Message) => {
    if (isLocal(m) || cantWrite) return;
    setReplyingTo(m);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** Double tap toggles the heart; it pops only when the heart is being added. */
  const toggleHeart = (m: Message) => {
    if (isLocal(m) || isBlocked) return;
    const hadIt = !!m.reactions?.some((r) => r.mine && r.emoji === QUICK_REACTION);
    if (!hadIt) setPop((p) => ({ id: m.id, n: (p?.n ?? 0) + 1 }));
    tapLight();
    react(m.id, QUICK_REACTION);
  };

  /** Long press: lift the bubble out where it sits and open the menu. */
  const openActions = (m: Message, mine: boolean, rect: BubbleRect | null) => {
    if (isLocal(m)) return;
    Keyboard.dismiss();
    tapLight();
    setActionFor({ message: m, mine, rect });
  };

  const copyMessage = (m: Message) => {
    if (copyText(m.body)) {
      hapticSuccess();
      setCopied(true);
      later(() => setCopied(false), COPIED_MS);
    }
  };

  /** "You" for the viewer's side, the other side's name otherwise. Never a teammate's name to the attendee. */
  const quoteAuthor = (role: 'attendee' | 'organizer') =>
    role === thread?.viewer_role ? t('attendeeMessages.you') : otherName;

  const jumpTo = (id: string) => {
    const y = rowY.current[id];
    if (y == null) return;
    nearBottom.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - headerH - 12), animated: true });
    setFlashId(id);
    later(() => setFlashId((f) => (f === id ? null : f)), 1200);
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

  /** A still copy of a bubble, lifted over the blur by the long-press menu. */
  const bubbleBody = (m: Message, mine: boolean) => (
    <>
      {m.reply_to ? (
        <QuotedMessage author={quoteAuthor(m.reply_to.author_role)} excerpt={m.reply_to.excerpt} onMine={mine} />
      ) : null}
      {/* Android (Samsung especially) clipped the last glyph of a line, which
          dropped a trailing emoji: simple line breaking, a trailing hair space
          (emojiSafe) and a 1pt end padding make the measured width cover it. */}
      <Text
        style={[styles.bubbleText, mine && styles.bubbleTextMine, isJumbo(m) && styles.jumboText]}
        textBreakStrategy="simple"
      >
        {emojiSafe(m.body)}
      </Text>
    </>
  );

  // Android draws edge to edge (app.json edgeToEdgeEnabled), so the window no
  // longer resizes for the keyboard: 'padding' lifts the composer there too.
  return (
    <GestureHandlerRootView style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior="padding">
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
          <Touchable
            style={styles.headerCenter}
            onPress={openOtherProfile}
            disabled={!thread?.other_id}
            scale={0.98}
            accessibilityRole={thread?.other_id ? 'button' : 'header'}
            accessibilityLabel={title}
            accessibilityHint={thread?.other_id ? t('messageExtras.openProfile') : undefined}
          >
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            {subtitle && subtitle !== title ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </Touchable>
          <Touchable
            style={styles.backButton}
            onPress={openOtherProfile}
            disabled={!thread?.other_id}
            accessibilityRole="button"
            accessibilityLabel={t('messageExtras.openProfile')}
          >
            {thread ? (
              <Image
                source={thread.other_photo ? { uri: thread.other_photo } : defaultAvatar(thread.id)}
                style={styles.headerAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </Touchable>
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
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              scrollEventThrottle={64}
              onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
                nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM_PX;
              }}
              // A new message keeps the latest in view, unless the reader has
              // scrolled up (a reaction or a quote jump must not yank them down).
              onContentSizeChange={() => {
                if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
              }}
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
                  <View style={styles.poster} />
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
                // Same author, same day, minutes apart: one run, set tight
                // together. Reactions break the run's spacing a little; the
                // time goes under the run's last bubble only.
                const joinsPrev =
                  !newDay && !!prev && prev.author_role === m.author_role && gap(prev, m) < RUN_GAP_MS;
                const endsRun =
                  !next ||
                  next.author_role !== m.author_role ||
                  !sameDay(m.created_at, next.created_at) ||
                  gap(m, next) >= RUN_GAP_MS;
                const senderName = byTeammate
                  ? m.sent_by || thread.organizer_name || m.author_name
                  : mine
                    ? t('attendeeMessages.you')
                    : m.author_name || otherName;
                const local = isLocal(m);
                const flashing = flashId === m.id;
                const jumbo = isJumbo(m);
                return (
                  <View
                    key={m.id}
                    onLayout={(e) => {
                      rowY.current[m.id] = e.nativeEvent.layout.y;
                    }}
                  >
                    {newDay ? (
                      <Text style={styles.dayLabel}>{dayLabel(m.created_at, language, dayLabels)}</Text>
                    ) : null}
                    <View
                      style={[
                        styles.bubbleRow,
                        mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
                        joinsPrev && styles.bubbleRowJoined,
                      ]}
                    >
                      <SwipeToReply
                        style={styles.bubbleSlot}
                        enabled={!local}
                        onReply={cantWrite ? undefined : () => startReply(m)}
                        onLongPress={(rect) => openActions(m, mine, rect)}
                        onDoubleTap={isBlocked ? undefined : () => toggleHeart(m)}
                        onTap={(y) => {
                          // A tap on the quote jumps to the quoted message.
                          const qb = quoteBottom.current[m.id];
                          if (m.reply_to && qb != null && y <= qb) jumpTo(m.reply_to.id);
                        }}
                      >
                        <View
                          style={[
                            styles.bubble,
                            jumbo ? styles.bubbleJumbo : mine ? styles.bubbleMine : styles.bubbleTheirs,
                            flashing && (mine && !jumbo ? styles.bubbleFlashMine : styles.bubbleFlashTheirs),
                          ]}
                          accessible
                          accessibilityLabel={`${senderName}: ${m.body}`}
                          // Screen readers can't double tap or swipe a bubble:
                          // the same heart, reply and copy are actions.
                          accessibilityActions={
                            local
                              ? []
                              : [
                                  ...(!isBlocked ? [{ name: 'react', label: strings.react.replace('{emoji}', QUICK_REACTION) }] : []),
                                  ...(!cantWrite ? [{ name: 'reply', label: strings.reply }] : []),
                                  ...(copyAvailable && m.body?.trim() ? [{ name: 'copy', label: strings.copy }] : []),
                                ]
                          }
                          onAccessibilityAction={(e) => {
                            const name = e.nativeEvent.actionName;
                            if (name === 'react') react(m.id, QUICK_REACTION);
                            else if (name === 'reply') startReply(m);
                            else if (name === 'copy') copyMessage(m);
                          }}
                        >
                          {m.reply_to ? (
                            <View
                              pointerEvents="none"
                              onLayout={(e) => {
                                const l = e.nativeEvent.layout;
                                quoteBottom.current[m.id] = l.y + l.height;
                              }}
                            >
                              <QuotedMessage
                                author={quoteAuthor(m.reply_to.author_role)}
                                excerpt={m.reply_to.excerpt}
                                onMine={mine}
                              />
                            </View>
                          ) : null}
                          <Text
                            style={[styles.bubbleText, mine && styles.bubbleTextMine, jumbo && styles.jumboText]}
                            textBreakStrategy="simple"
                          >
                            {emojiSafe(m.body)}
                          </Text>
                          {pop?.id === m.id ? (
                            <HeartPop
                              key={pop.n}
                              emoji={QUICK_REACTION}
                              onDone={() => setPop((p) => (p?.id === m.id ? null : p))}
                            />
                          ) : null}
                        </View>
                      </SwipeToReply>
                    </View>
                    {m.reactions?.length ? (
                      <ReactionPills
                        reactions={m.reactions}
                        alignRight={mine}
                        strings={strings}
                        onToggle={isBlocked ? undefined : (emoji) => react(m.id, emoji)}
                      />
                    ) : null}
                    {endsRun ? (
                      <Text
                        style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      >
                        {senderName}
                        {'  ·  '}
                        {clockTime(m.created_at, language)}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            <View style={[styles.composer, { paddingBottom: 10 + (keyboardUp ? 0 : insets.bottom) }]}>
              {isBlocked ? (
                <Text style={styles.composerNote}>
                  {thread.blocked_by_viewer ? t('messageExtras.youBlocked') : t('messageExtras.blocked')}
                </Text>
              ) : thread.closed ? (
                <Text style={styles.composerNote}>{t('attendeeMessages.closed')}</Text>
              ) : !isOrganizer && thread.awaiting_organizer ? (
                <Text style={styles.composerNote}>{t('attendeeMessages.awaiting')}</Text>
              ) : null}
              {isOrganizer && !hasOrganizerReply && !cantWrite ? (
                <Text style={styles.composerNote}>
                  {t('attendeeMessages.deliveredNote').replace('{name}', otherName)}
                </Text>
              ) : null}
              {copied ? (
                <Text style={styles.composerNote} accessibilityLiveRegion="polite">
                  {t('messageExtras.copied')}
                </Text>
              ) : null}
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!cantWrite && replyingTo ? (
                <ReplyPreview
                  author={quoteAuthor(replyingTo.author_role)}
                  excerpt={firstLine(replyingTo.body)}
                  strings={strings}
                  onDismiss={() => setReplyingTo(null)}
                />
              ) : null}
              {!cantWrite && (
                <View style={styles.inputRow}>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    value={draft}
                    onChangeText={(v) => setDraft(v.slice(0, maxLength))}
                    placeholder={t('attendeeMessages.placeholder').replace('{name}', otherName)}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    multiline
                    maxLength={maxLength}
                    // Stays editable while sending: toggling editable blurs the
                    // input on iOS and drops the keyboard after every message.
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

            <MessageActionsSheet
              visible={!!actionFor}
              anchor={actionFor?.rect ?? null}
              preview={
                actionFor ? (
                  <View
                    style={[
                      styles.bubble,
                      isJumbo(actionFor.message)
                        ? styles.bubbleJumbo
                        : actionFor.mine
                          ? styles.bubbleMine
                          : styles.bubbleTheirs,
                    ]}
                  >
                    {bubbleBody(actionFor.message, actionFor.mine)}
                  </View>
                ) : null
              }
              mine={actionFor?.message.reactions?.find((r) => r.mine)?.emoji ?? null}
              canReact={!isBlocked}
              canReply={!cantWrite}
              canCopy={copyAvailable && !!actionFor?.message.body?.trim()}
              // The other side's message: report them (the organization, or the attendee as a person).
              canReport={!!actionFor && !actionFor.mine && !!thread.other_id}
              strings={strings}
              onClose={() => setActionFor(null)}
              onReact={(emoji) => {
                const id = actionFor?.message.id;
                setActionFor(null);
                if (id) react(id, emoji);
              }}
              onReply={() => {
                const m = actionFor?.message;
                setActionFor(null);
                if (m) startReply(m);
              }}
              onCopy={() => {
                const m = actionFor?.message;
                setActionFor(null);
                if (m) copyMessage(m);
              }}
              onReport={() => {
                setActionFor(null);
                // Opening a sheet while the menu's modal fades out can drop it on iOS.
                later(() => setReporting(true), 350);
              }}
            />
            {thread.other_id ? (
              <ReportContentModal
                visible={reporting}
                onClose={() => setReporting(false)}
                kind="organizer"
                targetId={thread.other_id}
              />
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
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
    // A run reads as one block: its bubbles sit 2pt apart.
    bubbleRowJoined: { marginTop: 2 },
    bubbleRowMine: { justifyContent: 'flex-end' },
    bubbleRowTheirs: { justifyContent: 'flex-start' },
    // The swipe wrapper carries the width cap so the bubble hugs its text.
    bubbleSlot: { maxWidth: '82%' },
    bubble: { borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 10 },
    // Mine: solid white with black text, the app's primary-action pairing.
    // Theirs: the raised dark fill. Fills, never hairlines.
    bubbleMine: { backgroundColor: T.white },
    bubbleTheirs: { backgroundColor: colors.surfaceRaised },
    // A quote tapped: the message it points to brightens for a moment.
    bubbleFlashMine: { backgroundColor: T.textSecondary },
    bubbleFlashTheirs: { backgroundColor: T.neutralMuted },
    bubbleText: { fontSize: 15, lineHeight: 21, color: colors.text, paddingRight: 1 },
    bubbleTextMine: { color: T.onWhite },
    // Emoji-only (1 to 3): no fill, just the big glyphs in the system font.
    bubbleJumbo: { paddingHorizontal: 2, paddingVertical: 0 },
    jumboText: { fontSize: 40, lineHeight: 50, color: colors.text, fontFamily: undefined, paddingRight: 2 },
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
