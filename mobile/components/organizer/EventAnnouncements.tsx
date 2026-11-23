import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Bell, Clock, Heart, Plus, Send, X } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { font } from '../../theme/tokens';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { colors as T } from '../../theme/tokens';
import { backendJson } from '../../lib/api/backend';
import { inboxTime } from '../../lib/messageTime';
import { safeFormatForLanguage } from '../../lib/dates';
import SectionHeader from '../SectionHeader';
import WhitePillCTA from '../WhitePillCTA';
import { ListGroup, ListRow } from '../ui/ListRow';
import { Switch } from '../ui/Switch';
import { Skeleton } from '../Skeleton';
import EmptyState from '../EmptyState';
import { Touchable } from '../ui/Touchable';
import { useActiveOrg } from '../../lib/activeOrg';
import { getOrganizerEvents, type OrganizerEvent } from '../../lib/api/organizer';
import {
  BEFORE_PRESETS,
  FOLLOWUP_ID,
  MAX_REMINDERS,
  MESSAGE_MAX,
  STOCK_MINUTES,
  newReminderId,
  normalizeMessage,
  serverSpan,
  span,
  whenLabel,
} from './reminderCopy';

type Update = { id: string; title: string; message: string; createdAt: string | null; recipients: number | null };
type Auto = {
  type: string;
  at: string | null;
  sentAt: string | null;
  // Present from servers with editable reminders; older ones send only the above.
  id?: string;
  minutesBefore?: number | null;
  enabled?: boolean;
  message?: string | null;
  editable?: boolean;
};
/** One reminder as stored on the event (events/{id}.reminders). */
type Rem = { id: string; minutes_before: number; enabled: boolean; message?: string };
/** The row open in the sheet. */
type Editing = { id: string; isNew: boolean; editable: boolean; sentAt: string | null; at: string | null };
type Data = { updates: Update[]; automatic: Auto[] };

/** Newest sends shown before "Show all". */
const SENT_PREVIEW = 5;

const FALLBACK_AUTOS: Auto[] = [
  { type: 'event_reminder_24h', at: null, sentAt: null },
  { type: 'event_reminder_3h', at: null, sentAt: null },
  { type: 'event_reminder_30min', at: null, sentAt: null },
  { type: FOLLOWUP_ID, at: null, sentAt: null },
];

/**
 * The one-to-many half of an event's Messages page (owner, 2026-11-18: "include
 * the template messages as well, like bulk messages, notifications"): a compact
 * New message, what was sent to everyone, and the messages Tikèm sends on its
 * own with when they go out. Reminders can be switched off, moved, reworded,
 * removed and added (PUT /api/organizer/events/:id/reminders); the morning-after
 * thank-you is shown but not editable. No explainer copy.
 */
export default function EventAnnouncements({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const navigation: any = useNavigation();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { userProfile } = useAuth() as any;

  const load = useCallback(
    (isAlive: () => boolean = () => true) =>
      backendJson<Data>(`/api/organizer/event-update?eventId=${encodeURIComponent(eventId)}`)
        .then((d) => {
          if (isAlive()) {
            setData(d);
            setFailed(false);
          }
        })
        .catch(() => {
          if (isAlive()) setFailed(true);
        }),
    [eventId]
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load(() => alive);
      return () => {
        alive = false;
      };
    }, [load])
  );

  // Rows as the server sent them, normalized for older servers: reminders by
  // when they go out (earliest first), the morning-after thank-you last.
  const autos: Auto[] = (data?.automatic || FALLBACK_AUTOS)
    .map((a) => {
      const id = a.id || a.type;
      const followup = id === FOLLOWUP_ID;
      return {
        ...a,
        id,
        minutesBefore: followup ? null : a.minutesBefore ?? STOCK_MINUTES[id] ?? null,
        enabled: a.enabled !== false,
        // Older servers cannot save edits: editing needs their minutesBefore.
        editable: !followup && a.editable === true,
      };
    })
    .sort((x, y) => (y.minutesBefore ?? -1) - (x.minutesBefore ?? -1));
  const reminderRows = autos.filter((a) => a.id !== FOLLOWUP_ID);
  const canEdit = !!data && reminderRows.every((a) => a.editable);
  const rems: Rem[] = reminderRows.map((a) => ({
    id: a.id!,
    minutes_before: a.minutesBefore as number,
    enabled: a.enabled !== false,
    ...(a.message ? { message: a.message } : {}),
  }));

  const [editing, setEditing] = useState<Editing | null>(null);
  const [draftMinutes, setDraftMinutes] = useState<number>(1440);
  const [draftMessage, setDraftMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Replace the whole list on the server, then reload the page's data. */
  const save = async (next: Rem[]): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      await backendJson(`/api/organizer/events/${encodeURIComponent(eventId)}/reminders`, {
        method: 'PUT',
        body: JSON.stringify({ reminders: next }),
      });
      await load();
      return true;
    } catch {
      setSaveError(t('organizerReminders.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string, enabled: boolean) => {
    if (!data) return;
    // Optimistic: flip the row now, put it back if the save fails.
    const before = data;
    setData({ ...data, automatic: data.automatic.map((a) => ((a.id || a.type) === id ? { ...a, enabled } : a)) });
    save(rems.map((r) => (r.id === id ? { ...r, enabled } : r))).then((ok) => {
      if (!ok) setData(before);
    });
  };

  const openRow = (a: Auto) => {
    setSaveError(null);
    setDraftMinutes(a.minutesBefore ?? 1440);
    setDraftMessage(a.message || '');
    setEditing({ id: a.id!, isNew: false, editable: canEdit && !!a.editable && !a.sentAt, sentAt: a.sentAt, at: a.at });
  };

  const openNew = () => {
    const used = new Set(rems.map((r) => r.minutes_before));
    const free = BEFORE_PRESETS.find((m) => !used.has(m)) ?? 60;
    setSaveError(null);
    setDraftMinutes(free);
    setDraftMessage('');
    setEditing({ id: newReminderId(), isNew: true, editable: true, sentAt: null, at: null });
  };

  const saveEditor = async () => {
    if (!editing) return;
    const message = normalizeMessage(draftMessage);
    const r: Rem = { id: editing.id, minutes_before: draftMinutes, enabled: true, ...(message ? { message } : {}) };
    const next = editing.isNew
      ? [...rems, r]
      : rems.map((x) => (x.id === editing.id ? { ...r, enabled: x.enabled } : x));
    if (await save(next)) setEditing(null);
  };

  const removeEditing = async () => {
    if (!editing) return;
    if (await save(rems.filter((x) => x.id !== editing.id))) setEditing(null);
  };

  const status = (a: Auto) => {
    if (a.sentAt) return t('organizerMessages.statusSent');
    if (a.enabled === false) return t('organizerReminders.off');
    if (a.at && new Date(a.at).getTime() < Date.now()) return null; // window passed before the event existed
    return a.at ? safeFormatForLanguage(a.at, 'MMM d, h:mm a', language) : t('organizerMessages.morningAfter');
  };

  /** The row's name: the stock wording for an untouched stock time, else built from its time. */
  const titleOf = (id: string, minutes: number | null | undefined) => {
    if (id === FOLLOWUP_ID) return t('organizerMessages.auto.post_event_followup');
    if (minutes != null && STOCK_MINUTES[id] === minutes) return t(`organizerMessages.auto.${id}`);
    if (minutes == null) return t('organizerReminders.reminder');
    return `${t('organizerReminders.reminder')} · ${span(minutes, t)}`;
  };

  // What attendees actually receive, mirrored from the server copy
  // (lib/notification-triggers sendEventReminder for an untouched stock
  // reminder, lib/notifications/event-reminder-send for the rest,
  // lib/postEvent/server for the thank-you).
  const org = (userProfile?.organization_name || userProfile?.full_name || 'Tikèm').trim();
  const previewOf = (id: string, minutes: number | null, message: string | null) => {
    if (id === FOLLOWUP_ID) {
      return {
        title: t('organizerMessages.preview.followupTitle', { event: eventTitle }),
        body: t('organizerMessages.preview.followupBody', { org }),
        channels: t('organizerMessages.preview.channelsPush'),
        who: t('organizerMessages.preview.whoCheckedIn'),
      };
    }
    const stock = minutes != null && STOCK_MINUTES[id] === minutes && !message;
    return {
      title: stock ? 'Event Reminder' : `Reminder: ${eventTitle}`,
      // The server attributes the organizer's words (never Tikèm's voice).
      body: message ? `${org}: ${message}` : `"${eventTitle}" starts in ${serverSpan(minutes ?? 0)}!`,
      channels:
        minutes === 1440 ? t('organizerMessages.preview.channelsAll') : t('organizerMessages.preview.channelsPush'),
      who: t('organizerMessages.preview.whoTicketHolders'),
    };
  };

  // The sheet shows the reminder as it would go out with the draft applied.
  const editingAuto = editing ? autos.find((a) => a.id === editing.id) : null;
  const pv = editing
    ? editing.editable
      ? previewOf(editing.id, draftMinutes, normalizeMessage(draftMessage) || null)
      : previewOf(editing.id, editingAuto?.minutesBefore ?? null, editingAuto?.message || null)
    : null;
  const pvStatus = editingAuto ? status(editingAuto) : null;
  const usedMinutes = new Set(rems.filter((r) => r.id !== editing?.id).map((r) => r.minutes_before));
  const chipMinutes = BEFORE_PRESETS.includes(draftMinutes) ? BEFORE_PRESETS : [draftMinutes, ...BEFORE_PRESETS];
  const sheetTitle = editing
    ? editing.isNew
      ? t('organizerReminders.newTitle')
      : titleOf(editing.id, editingAuto?.minutesBefore).toLowerCase()
    : '';

  return (
    <View style={styles.wrap}>
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior="padding">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setEditing(null)} accessible={false} />
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                {sheetTitle}
              </Text>
              <TouchableOpacity
                onPress={() => setEditing(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            {editing && pv ? (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {/* The notification as it lands on a phone. */}
                <View style={[styles.notif, { backgroundColor: colors.surfaceRaised }]}>
                  <Text style={[styles.notifApp, { color: colors.textSecondary }]}>TIKÈM</Text>
                  <Text style={[styles.notifTitle, { color: colors.text }]} numberOfLines={2}>{pv.title}</Text>
                  <Text style={[styles.notifBody, { color: colors.textSecondary }]} numberOfLines={3}>{pv.body}</Text>
                </View>
                <View style={styles.facts}>
                  <Text style={[styles.fact, { color: colors.textSecondary }]}>
                    {[editing.editable ? null : pvStatus, pv.who].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={[styles.fact, { color: colors.textSecondary }]}>{pv.channels}</Text>
                </View>

                {/* Once sent (or for the thank-you) there is nothing to change. */}
                {editing.editable ? (
                  <>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t('organizerReminders.when')}
                    </Text>
                    <View style={styles.presetWrap}>
                      {chipMinutes.map((m) => {
                        const active = m === draftMinutes;
                        const taken = !active && usedMinutes.has(m);
                        return (
                          <Touchable
                            key={String(m)}
                            disabled={taken}
                            onPress={() => setDraftMinutes(m)}
                            style={[
                              styles.preset,
                              {
                                backgroundColor: active ? colors.white : colors.surfaceRaised,
                                opacity: taken ? 0.4 : 1,
                              },
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: taken }}
                          >
                            <Text style={[styles.presetText, { color: active ? T.onWhite : colors.text }]}>
                              {whenLabel(m, t)}
                            </Text>
                          </Touchable>
                        );
                      })}
                    </View>

                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                      {t('organizerReminders.messageLabel')}
                    </Text>
                    <TextInput
                      value={draftMessage}
                      onChangeText={(v) => setDraftMessage(v.slice(0, MESSAGE_MAX))}
                      placeholder={t('organizerReminders.messagePlaceholder')}
                      placeholderTextColor={colors.textTertiary}
                      multiline
                      maxLength={MESSAGE_MAX}
                      style={[styles.input, { backgroundColor: colors.surfaceRaised, color: colors.text }]}
                    />
                    {draftMessage.length > MESSAGE_MAX - 40 ? (
                      <Text style={[styles.count, { color: colors.textTertiary }]}>
                        {draftMessage.length}/{MESSAGE_MAX}
                      </Text>
                    ) : null}

                    {saveError ? <Text style={[styles.error, { color: colors.error }]}>{saveError}</Text> : null}

                    <View style={styles.sheetActions}>
                      <WhitePillCTA
                        size="sm"
                        label={t('organizerReminders.save')}
                        onPress={saveEditor}
                        loading={saving}
                        disabled={saving}
                      />
                      {!editing.isNew ? (
                        <Touchable onPress={removeEditing} disabled={saving} accessibilityRole="button" style={styles.removeBtn}>
                          <Text style={[styles.removeText, { color: colors.error }]}>{t('organizerReminders.remove')}</Text>
                        </Touchable>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <WhitePillCTA
        size="sm"
        label={t('organizerMessages.newMessage')}
        onPress={() => navigation.navigate('SendEventUpdate', { eventId, eventTitle })}
        style={styles.cta}
      />

      {/* Automatic first: rows that stay in reach however long the sent
          history grows (owner, 2026-11-18). Each reminder can be switched
          off, tapped to change its time or words, removed, and more added. */}
      <SectionHeader title={t('organizerMessages.automaticTitle')} />
      <ListGroup>
        {[
          ...autos.map((a) => {
            const s = data ? status(a) : null;
            const switchable = canEdit && !!a.editable && !a.sentAt;
            const title = titleOf(a.id!, a.minutesBefore);
            return (
              <ListRow
                key={a.id}
                icon={a.id === FOLLOWUP_ID ? Heart : (a.minutesBefore ?? 0) >= 1440 ? Bell : Clock}
                title={title}
                subtitle={s ? [s, a.message || ''].filter(Boolean).join(' · ') : undefined}
                onPress={data ? () => openRow(a) : undefined}
                trailing={
                  switchable ? (
                    <Switch
                      value={a.enabled !== false}
                      onValueChange={(v) => toggle(a.id!, v)}
                      disabled={saving}
                      accessibilityLabel={title}
                    />
                  ) : undefined
                }
              />
            );
          }),
          ...(canEdit && reminderRows.length < MAX_REMINDERS
            ? [<ListRow key="__add" icon={Plus} title={t('organizerReminders.add')} onPress={openNew} />]
            : []),
        ]}
      </ListGroup>
      {saveError && !editing ? <Text style={[styles.error, { color: colors.error }]}>{saveError}</Text> : null}

      <View style={styles.gap} />
      <SectionHeader title={t('organizerMessages.sentSection')} />
      {!data && !failed ? (
        <Skeleton width="100%" height={52} />
      ) : (data?.updates || []).length === 0 ? (
        <Text style={styles.quiet}>{t('organizerMessages.nothingSent')}</Text>
      ) : (
        <ListGroup>
          {(showAll ? data!.updates : data!.updates.slice(0, SENT_PREVIEW)).map((u) => (
            <ListRow
              key={u.id}
              icon={Send}
              title={u.title}
              subtitle={[
                u.createdAt ? inboxTime(u.createdAt, language, { yesterday: t('attendeeMessages.yesterday') }) : '',
                u.recipients == null
                  ? ''
                  : u.recipients === 1
                    ? t('organizerMessages.recipientsOne')
                    : t('organizerMessages.recipients', { count: u.recipients }),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </ListGroup>
      )}
      {(data?.updates.length || 0) > SENT_PREVIEW && !showAll ? (
        <Touchable style={styles.showAll} onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={styles.showAllText}>
            {t('organizerMessages.showAllSent', { count: data!.updates.length })}
          </Text>
        </Touchable>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  cta: { alignSelf: 'flex-start', marginBottom: 24 },
  quiet: { fontSize: 13, color: T.textSecondary },
  gap: { height: 28 },
  showAll: { paddingVertical: 12, alignSelf: 'flex-start' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontFamily: font.serif, fontSize: 24, lineHeight: 28, flexShrink: 1, marginRight: 12 },
  notif: { borderRadius: 4, padding: 14 },
  notifApp: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  notifTitle: { fontSize: 15, fontWeight: '600' },
  notifBody: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  facts: { marginTop: 14, gap: 4 },
  fact: { fontSize: 13 },
  showAllText: { fontSize: 13, fontWeight: '600', color: T.textSecondary },
  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, marginTop: 22, marginBottom: 8 },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4 },
  presetText: { fontSize: 13, fontWeight: '600' },
  input: { borderRadius: 4, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 72, textAlignVertical: 'top' },
  count: { fontSize: 12, marginTop: 4, alignSelf: 'flex-end' },
  error: { fontSize: 13, marginTop: 10 },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 20 },
  removeBtn: { paddingVertical: 10 },
  removeText: { fontSize: 14, fontWeight: '600' },
  chipRail: { marginBottom: 6 },
  chips: { paddingHorizontal: 16, gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, maxWidth: 200 },
  chipText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
});

/**
 * The organizer bar's Messages tab, Announcements side: the same view for one
 * event at a time, picked from quiet chips. Opens on the next upcoming event
 * (else the most recent). Cancelled events are left out.
 */
export function OrgAnnouncements() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { orgId } = useActiveOrg();
  const [events, setEvents] = useState<OrganizerEvent[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!orgId) return;
      let alive = true;
      getOrganizerEvents(orgId, 100)
        .then((list) => {
          if (!alive) return;
          const now = Date.now();
          const live = list.filter((e) => e.status !== 'cancelled' && e.status !== 'draft');
          const time = (e: OrganizerEvent) => new Date(e.start_datetime).getTime() || 0;
          const upcoming = live.filter((e) => time(e) >= now - 12 * 3600_000).sort((a, b) => time(a) - time(b));
          const past = live.filter((e) => time(e) < now - 12 * 3600_000).sort((a, b) => time(b) - time(a));
          setEvents([...upcoming, ...past]);
        })
        .catch(() => alive && setEvents([]));
      return () => {
        alive = false;
      };
    }, [orgId])
  );

  if (!events) return <View style={styles.wrap}><Skeleton width="60%" height={28} /></View>;
  if (events.length === 0) {
    return <EmptyState variant="panel" icon={Send} title={t('organizerMessages.noEventsYet')} />;
  }
  const current = events.find((e) => e.id === picked) || events[0];

  return (
    <View>
      {events.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipRail}>
          {events.slice(0, 20).map((e) => {
            const active = e.id === current.id;
            return (
              <Touchable
                key={e.id}
                style={[styles.chip, { backgroundColor: active ? colors.white : colors.surface }]}
                onPress={() => setPicked(e.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text numberOfLines={1} style={[styles.chipText, { color: active ? T.onWhite : colors.textSecondary }]}>
                  {e.title}
                </Text>
              </Touchable>
            );
          })}
        </ScrollView>
      )}
      <EventAnnouncements key={current.id} eventId={current.id} eventTitle={current.title} />
    </View>
  );
}
