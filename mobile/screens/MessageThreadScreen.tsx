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
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowUp, MessageCircle } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { Skeleton } from '../components/Skeleton';
import { backendJson } from '../lib/api/backend';
import { safeFormatForLanguage } from '../lib/dates';
import { font, radius } from '../theme/tokens';

/** Mirrors MAX_FOLLOWUP_LENGTH / MAX_REPLY_LENGTH in lib/organizer-messages.ts. */
const MAX_ATTENDEE_LENGTH = 1000;
const MAX_ORGANIZER_LENGTH = 2000;

type Message = {
  id: string;
  body: string;
  author_role: 'attendee' | 'organizer';
  author_name: string;
  created_at: string | null;
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
};

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
      backendJson(`/api/messages/${encodeURIComponent(threadId)}/read`, { method: 'POST' }).catch(() => {});
    } catch (e) {
      console.warn('Failed to load conversation', e);
      setStatus('error');
    }
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  const when = (iso: string | null) => (iso ? safeFormatForLanguage(iso, 'MMM d, h:mm a', language) : '');

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

  const title = thread?.event_title || route?.params?.eventTitle || t('attendeeMessages.title');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header}>
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
          {title}
        </Text>
        <View style={styles.backButton} />
      </OverlayHeader>

      {status === 'loading' ? (
        <View style={{ paddingTop: headerH + 16, paddingHorizontal: 16, gap: 12 }}>
          <Skeleton width="70%" height={18} radius={4} />
          <Skeleton width="80%" height={64} radius={radius.md} />
          <Skeleton width="60%" height={48} radius={radius.md} style={{ alignSelf: 'flex-end' }} />
        </View>
      ) : status === 'error' || !thread ? (
        <View style={[styles.emptyWrap, { paddingTop: headerH }]}>
          <EmptyState icon={MessageCircle} title={t('attendeeMessages.threadFailed')} />
          <TouchableOpacity style={styles.retry} onPress={load}>
            <Text style={styles.retryText}>{t('attendeeMessages.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: 16, paddingTop: headerH + 12, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            <TouchableOpacity
              style={styles.eventRow}
              onPress={() => navigation.navigate('EventDetail', { eventId: thread.event_id })}
              activeOpacity={0.75}
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
                {otherName ? (
                  <Text style={styles.eventSub} numberOfLines={1}>
                    {otherName}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>

            {thread.messages.map((m) => {
              const mine = m.author_role === thread.viewer_role;
              const name = mine ? t('attendeeMessages.you') : m.author_name || otherName;
              return (
                <View key={m.id} style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={styles.bubbleText}>{m.body}</Text>
                    <Text style={styles.bubbleMeta}>
                      {name} · {when(m.created_at)}
                    </Text>
                  </View>
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
                <TouchableOpacity
                  style={[styles.sendButton, (sending || !draft.trim()) && styles.sendButtonDisabled]}
                  onPress={send}
                  disabled={sending || !draft.trim()}
                  accessibilityRole="button"
                  accessibilityLabel={t('attendeeMessages.send')}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <ArrowUp size={20} color="#000" />
                  )}
                </TouchableOpacity>
              </View>
            )}
            {!blocked && !isOrganizer ? (
              <Text style={styles.privacy}>{t('attendeeMessages.privacy')}</Text>
            ) : null}
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
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 20, color: colors.text },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    retry: {
      marginTop: 20,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
    },
    retryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      marginBottom: 18,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    poster: { width: 44, height: 55, borderRadius: radius.poster, backgroundColor: colors.surfaceRaised },
    posterFallback: {},
    eventTitle: { fontFamily: font.serif, fontSize: 18, color: colors.text },
    eventSub: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
    bubbleRow: { flexDirection: 'row', marginBottom: 10 },
    bubbleRowMine: { justifyContent: 'flex-end' },
    bubbleRowTheirs: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '85%', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11 },
    // Mine: the brighter raised fill. Theirs: the quieter surface. Fills, not hairlines.
    bubbleMine: { backgroundColor: colors.surfaceRaised },
    bubbleTheirs: { backgroundColor: colors.surface },
    bubbleText: { fontSize: 15, lineHeight: 22, color: colors.text },
    bubbleMeta: { marginTop: 6, fontSize: 11, color: colors.textTertiary },
    composer: { paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.background },
    composerNote: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginBottom: 8, paddingHorizontal: 4 },
    errorText: { fontSize: 13, color: colors.error, marginBottom: 8, paddingHorizontal: 4 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 140,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 16,
      color: colors.text,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: radius.button,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonDisabled: { opacity: 0.4 },
    privacy: { marginTop: 8, fontSize: 11, lineHeight: 15, color: colors.textTertiary, paddingHorizontal: 4 },
  });
