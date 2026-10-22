import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, MessageSquare, Search, Share2, UserPlus, Users, X } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useSocialFlags } from '../lib/socialFlags';
import { radius } from '../theme/tokens';
import { fetchInviteLink, fetchInvitePicker, sendInvites, type InvitePickerFriend } from '../lib/api/invites';
import { sendConnectionRequest } from '../lib/api/social';
import {
  contactsPermission,
  requestContactsPermission,
  syncContacts,
  updateCachedMatch,
  type DeviceContact,
} from '../lib/contactSync';
import { contactPhoneE164, matchedContactIds, openWhatsAppInvite, smsUrl } from '../lib/inviteLink';
import { requestPhonePrompt, usePhonePromptAvailable } from '../lib/phonePrompt';
import type { ContactMatch } from '../types/social';
import PersonAvatar from './PersonAvatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from './AppAlert';

const MAX_SELECTED = 20;
/** Contacts rendered at most; the search box reaches the rest. */
const MAX_CONTACT_ROWS = 60;
/** How long the "sent" state shows on the button before the sheet closes. */
const SENT_HOLD_MS = 900;

type ContactsState =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'denied' }
  | { kind: 'loading' }
  | { kind: 'ready'; contacts: DeviceContact[]; matches: ContactMatch[] };

export interface InviteEventInfo {
  title?: string | null;
  /** "Sat, Oct 24 · Place Boyer": goes into the shared message. */
  details?: string | null;
}

/** WhatsApp's glyph (the share row's first action). */
function WhatsAppGlyph({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </Svg>
  );
}

/**
 * "Invite friends" (web lib/invites), one sheet for everyone:
 * - friends going (a face pile) as social proof,
 * - a share row (WhatsApp, Messages, the system sheet) carrying the viewer's
 *   personal link for this event, for anyone at all,
 * - the viewer's ACCEPTED connections, multi-select, sent as in-app invites
 *   (already invited / going / can't invite read as a dot + label),
 * - their phone contacts: people already on Tikèm can be added as friends,
 *   everyone else gets a WhatsApp invite with the event and the link.
 * Contacts are only read once access is granted, and never leave the phone
 * except as numbers to match (lib/contactSync.ts).
 */
export function InviteFriendsSheet({
  visible,
  eventId,
  event,
  autoConnect = false,
  onNeedPhone,
  onClose,
}: {
  visible: boolean;
  eventId: string;
  event?: InviteEventInfo;
  /** Ask for contacts straight away (back from the add-your-number sheet). */
  autoConnect?: boolean;
  /** Contact matching needs a verified number first: the host shows that sheet. */
  onNeedPhone?: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const needsPhone = usePhonePromptAvailable();
  const [friends, setFriends] = useState<InvitePickerFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [contacts, setContacts] = useState<ContactsState>({ kind: 'checking' });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const linkRef = useRef<string | null>(null);
  const uid = user?.uid || '';

  const loadContacts = useCallback(
    async (force = false) => {
      setContacts({ kind: 'loading' });
      try {
        const res = await syncContacts(uid, { force });
        setContacts({ kind: 'ready', ...res });
      } catch {
        setContacts({ kind: 'idle' });
        showAlert(t('connections.find.errorTitle'), t('connections.find.errorBody'));
      }
    },
    [uid, showAlert, t]
  );

  const connectContacts = useCallback(async () => {
    if (needsPhone && onNeedPhone) {
      onNeedPhone();
      return;
    }
    if (await requestContactsPermission()) loadContacts(true);
    else setContacts({ kind: 'denied' });
  }, [needsPhone, onNeedPhone, loadContacts]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setFriends(null);
    setFailed(false);
    setSelected(new Set());
    setQuery('');
    setSent(false);
    fetchInvitePicker(eventId).then((list) => {
      if (!active) return;
      if (list === null) {
        setFailed(true);
        setFriends([]);
      } else {
        setFriends(list);
      }
    });
    // Contacts: matched silently when access was already given, else offered.
    contactsPermission().then((p) => {
      if (!active) return;
      if (p === 'granted' && !needsPhone) loadContacts(false);
      else if (autoConnect) connectContacts();
      else setContacts({ kind: p === 'denied' ? 'denied' : 'idle' });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eventId]);

  const q = query.trim().toLowerCase();
  const filteredFriends = useMemo(
    () => (friends || []).filter((f) => !q || f.displayName.toLowerCase().includes(q)),
    [friends, q]
  );
  const going = useMemo(() => (friends || []).filter((f) => f.state === 'going'), [friends]);

  // Contacts split: people on Tikèm who are not friends yet (add them), and
  // everyone else (invite them). Friends already show in the list above.
  const { people, others } = useMemo(() => {
    if (contacts.kind !== 'ready') return { people: [] as ContactMatch[], others: [] as DeviceContact[] };
    const matched = matchedContactIds(contacts.contacts, contacts.matches);
    return {
      people: contacts.matches
        .filter((m) => m.friendship !== 'friends' && m.friendship !== 'self')
        .filter((m) => !q || m.displayName.toLowerCase().includes(q)),
      others: contacts.contacts
        .filter((c) => !matched.has(c.id))
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, MAX_CONTACT_ROWS),
    };
  }, [contacts, q]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });

  const send = async () => {
    if (selected.size === 0 || sending || sent) return;
    setSending(true);
    const result = await sendInvites(eventId, Array.from(selected));
    setSending(false);
    if (!result.ok) {
      if (result.reason === 'limit') showAlert(t('invites.limitTitle'), t('invites.limitBody'));
      else showAlert(t('invites.errorTitle'), t('invites.errorBody'));
      return;
    }
    const done = new Set(result.sent.length ? result.sent : selected);
    setFriends((list) => (list || []).map((f) => (done.has(f.uid) ? { ...f, state: 'invited' } : f)));
    setSelected(new Set());
    setSent(true);
    setTimeout(onClose, SENT_HOLD_MS);
  };

  /** The message every share path sends: the event, when and where, the personal link. */
  const message = async (): Promise<string | null> => {
    const link = linkRef.current || (await fetchInviteLink(eventId));
    if (!link) {
      showAlert(t('invites.errorTitle'), t('invites.linkError'));
      return null;
    }
    linkRef.current = link;
    if (!event?.title) return t('invites.messageApp', { link });
    if (!event.details) return t('invites.messageEvent', { event: event.title, link });
    return t('invites.messageEventRich', { event: event.title, details: event.details, link });
  };

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await fn();
    } finally {
      setBusyKey(null);
    }
  };

  const shareVia = (via: 'whatsapp' | 'sms' | 'more') =>
    withBusy(`share:${via}`, async () => {
      const text = await message();
      if (!text) return;
      if (via === 'whatsapp') return openWhatsAppInvite(text);
      if (via === 'sms') {
        try {
          await Linking.openURL(smsUrl(text, null, Platform.OS));
          return;
        } catch {
          // no Messages app: fall through to the share sheet
        }
      }
      try {
        await Share.share({ message: text });
      } catch {
        // dismissed
      }
    });

  const inviteContact = (c: DeviceContact) =>
    withBusy(`contact:${c.id}`, async () => {
      const text = await message();
      if (text) await openWhatsAppInvite(text, contactPhoneE164(c.phone) || c.phone);
    });

  const addPerson = (m: ContactMatch) =>
    withBusy(`person:${m.uid}`, async () => {
      try {
        const friendship = await sendConnectionRequest(m.uid);
        updateCachedMatch(uid, m.uid, { friendship });
        setContacts((s) =>
          s.kind === 'ready' ? { ...s, matches: s.matches.map((x) => (x.uid === m.uid ? { ...x, friendship } : x)) } : s
        );
      } catch {
        showAlert(t('invites.errorTitle'), t('invites.requestErrorBody'));
      }
    });

  const stateLabel = (s: InvitePickerFriend['state']) =>
    s === 'invited' ? t('invites.stateInvited') : s === 'going' ? t('invites.stateGoing') : t('invites.stateUnavailable');

  const hasFriends = (friends || []).length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            {/* Paints below the sheet's edge: on device the sheet stopped short
                of the screen bottom and the page showed through the gap. */}
            <View pointerEvents="none" style={styles.bottomFill} />
            <View style={styles.grabber} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t('invites.pickerTitle').toLowerCase()}</Text>
                {!!event?.title && (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {[event.title, event.details].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={12}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel={t('invites.close')}
              >
                <X size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {going.length > 0 && (
              <View style={styles.goingRow}>
                <View style={styles.pile}>
                  {going.slice(0, 4).map((f, i) => (
                    <View key={f.uid} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }}>
                      <PersonAvatar user={f} size={28} ring />
                    </View>
                  ))}
                </View>
                <Text style={styles.goingText}>
                  {going.length === 1
                    ? t('invites.friendsGoingOne')
                    : t('invites.friendsGoing', { count: going.length })}
                </Text>
              </View>
            )}

            <View style={styles.shareRow}>
              {(
                [
                  { via: 'whatsapp', label: t('invites.shareWhatsApp'), icon: <WhatsAppGlyph color={colors.text} /> },
                  { via: 'sms', label: t('invites.shareMessages'), icon: <MessageSquare size={20} color={colors.text} /> },
                  { via: 'more', label: t('invites.shareMore'), icon: <Share2 size={20} color={colors.text} /> },
                ] as const
              ).map((a) => (
                <TouchableOpacity
                  key={a.via}
                  style={styles.shareTile}
                  onPress={() => shareVia(a.via)}
                  disabled={!!busyKey}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                >
                  <View style={styles.shareIcon}>
                    {busyKey === `share:${a.via}` ? <ActivityIndicator size="small" color={colors.text} /> : a.icon}
                  </View>
                  <Text style={styles.shareLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.searchBox}>
              <Search size={18} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={contacts.kind === 'ready' ? t('invites.searchAll') : t('invites.search')}
                placeholderTextColor={colors.textTertiary || colors.textSecondary}
                selectionColor={colors.primary}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>{t('invites.sectionFriends')}</Text>
              {friends === null ? (
                <ActivityIndicator style={{ marginVertical: 20 }} color={colors.textSecondary} />
              ) : failed ? (
                <Text style={styles.empty}>{t('invites.loadError')}</Text>
              ) : !hasFriends ? (
                <Text style={styles.empty}>{t('invites.emptyFriends')}</Text>
              ) : filteredFriends.length === 0 ? (
                <Text style={styles.empty}>{t('invites.noMatch')}</Text>
              ) : (
                filteredFriends.map((f) => {
                  const selectable = f.state === 'available';
                  const on = selected.has(f.uid);
                  return (
                    <TouchableOpacity
                      key={f.uid}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => selectable && toggle(f.uid)}
                      disabled={!selectable}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: !selectable }}
                    >
                      <PersonAvatar user={f} size={44} />
                      <Text style={[styles.name, !selectable && styles.nameMuted]} numberOfLines={1}>
                        {f.displayName}
                      </Text>
                      {selectable ? (
                        <View style={[styles.check, on && styles.checkOn]}>
                          {on ? <Check size={15} color={colors.background} strokeWidth={3} /> : null}
                        </View>
                      ) : (
                        // Dot + label, never a filled status pill.
                        <View style={styles.stateWrap}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: f.state === 'going' ? colors.primary : colors.textTertiary },
                            ]}
                          />
                          <Text style={styles.stateText}>{stateLabel(f.state)}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}

              <Text style={[styles.sectionLabel, { marginTop: 22 }]}>{t('invites.sectionContacts')}</Text>
              {contacts.kind === 'checking' || contacts.kind === 'loading' ? (
                <ActivityIndicator style={{ marginVertical: 20 }} color={colors.textSecondary} />
              ) : contacts.kind === 'idle' || contacts.kind === 'denied' ? (
                <View style={styles.connectCard}>
                  <View style={styles.connectIcon}>
                    <Users size={20} color={colors.text} />
                  </View>
                  <Text style={styles.connectTitle}>{t('invites.contactsCardTitle')}</Text>
                  <Text style={styles.connectBody}>
                    {contacts.kind === 'denied' ? t('invites.contactsDenied') : t('invites.contactsCardBody')}
                  </Text>
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={() => (contacts.kind === 'denied' ? Linking.openSettings().catch(() => {}) : connectContacts())}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <Text style={styles.connectBtnText}>
                      {contacts.kind === 'denied' ? t('invites.openSettings') : t('invites.contactsConnect')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : people.length === 0 && others.length === 0 ? (
                <Text style={styles.empty}>{q ? t('invites.contactsNoMatch') : t('invites.contactsAllDone')}</Text>
              ) : (
                <>
                  {people.map((m) => {
                    const requested = m.friendship === 'request_sent';
                    return (
                      <View key={m.uid} style={styles.row}>
                        <PersonAvatar user={m} size={44} />
                        <Text style={styles.name} numberOfLines={1}>
                          {m.displayName}
                        </Text>
                        {requested ? (
                          <View style={styles.stateWrap}>
                            <View style={[styles.dot, { backgroundColor: colors.textTertiary }]} />
                            <Text style={styles.stateText}>{t('invites.requested')}</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.rowBtnQuiet}
                            onPress={() => addPerson(m)}
                            disabled={!!busyKey}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('invites.addFriend')} ${m.displayName}`}
                          >
                            {busyKey === `person:${m.uid}` ? (
                              <ActivityIndicator size="small" color={colors.text} />
                            ) : (
                              <>
                                <UserPlus size={14} color={colors.text} />
                                <Text style={styles.rowBtnQuietText}>{t('invites.addFriend')}</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                  {others.map((c) => (
                    <View key={c.id} style={styles.row}>
                      <View style={styles.initial}>
                        <Text style={styles.initialText}>{(c.name || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.name} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <TouchableOpacity
                        style={styles.rowBtn}
                        onPress={() => inviteContact(c)}
                        disabled={!!busyKey}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('invites.invite')} ${c.name}`}
                      >
                        {busyKey === `contact:${c.id}` ? (
                          <ActivityIndicator size="small" color="#000000" />
                        ) : (
                          <>
                            <WhatsAppGlyph size={13} color="#000000" />
                            <Text style={styles.rowBtnText}>{t('invites.invite')}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
              <View style={{ height: 12 }} />
            </ScrollView>

            {hasFriends && (
              <TouchableOpacity
                style={[styles.submit, selected.size === 0 && !sent && styles.submitDisabled]}
                onPress={send}
                disabled={(selected.size === 0 && !sent) || sending}
                accessibilityRole="button"
              >
                {sending ? (
                  <ActivityIndicator color="#000000" />
                ) : sent ? (
                  <View style={styles.sentWrap}>
                    <Check size={18} color="#000000" strokeWidth={3} />
                    <Text style={styles.submitText}>{t('invites.sentTitle')}</Text>
                  </View>
                ) : (
                  <Text style={[styles.submitText, selected.size === 0 && styles.submitTextDisabled]}>
                    {selected.size === 0 ? t('invites.selectFriends') : t('invites.sendCount', { count: selected.size })}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * The event page entry point: a filled row that opens the sheet. Signed-in
 * only, behind config/auth.invites (the server enforces it again).
 */
export default function InviteFriendsRow({
  eventId,
  invitable = true,
  event,
}: {
  eventId: string;
  invitable?: boolean;
  event?: InviteEventInfo;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const flags = useSocialFlags();
  const [open, setOpen] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);
  const styles = getStyles(colors);
  if (!flags.invites || !user || !eventId || !invitable) return null;
  // The add-your-number sheet is its own modal at the app root: step aside for
  // it, then come back and read the contacts once the number is linked.
  const needPhone = () => {
    setOpen(false);
    requestPhonePrompt({
      trigger: 'find_friends',
      onLinked: () => {
        setAutoConnect(true);
        setOpen(true);
      },
    });
  };
  return (
    <>
      <TouchableOpacity
        style={styles.entry}
        onPress={() => {
          setAutoConnect(false);
          setOpen(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('invites.inviteFriends')}
      >
        <View style={styles.entryIcon}>
          <UserPlus size={18} color={colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.entryTitle}>{t('invites.inviteFriends')}</Text>
          <Text style={styles.entrySub} numberOfLines={1}>
            {t('invites.inviteFriendsSub')}
          </Text>
        </View>
      </TouchableOpacity>
      <InviteFriendsSheet
        visible={open}
        eventId={eventId}
        event={event}
        autoConnect={autoConnect}
        onNeedPhone={needPhone}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheetWrap: { width: '100%' },
    // A fixed tall sheet, not auto-height: the list gets the room and never
    // collapses to a sliver behind the button.
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      height: '90%',
    },
    bottomFill: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '100%',
      height: 400,
      backgroundColor: colors.surface,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      marginTop: 10,
      marginBottom: 14,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    // Editorial sheet title, lowercased at the call site (house voice).
    title: { fontFamily: 'InstrumentSerif_400Regular', fontSize: 30, lineHeight: 34, color: colors.text },
    close: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, lineHeight: 19 },
    goingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    pile: { flexDirection: 'row' },
    goingText: { fontSize: 14, fontWeight: '600', color: colors.text },
    shareRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    shareTile: {
      flex: 1,
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      paddingVertical: 14,
    },
    shareIcon: { height: 22, alignItems: 'center', justifyContent: 'center' },
    shareLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 12 : 4,
      marginTop: 14,
    },
    searchInput: { flex: 1, fontSize: 16, color: colors.text },
    list: { flex: 1, marginTop: 8 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginTop: 12,
      marginBottom: 4,
    },
    empty: { fontSize: 14, color: colors.textSecondary, marginVertical: 14, lineHeight: 20 },
    // Borderless rows; a selected friend lifts one fill step instead of
    // getting a divider-boxed card.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginHorizontal: -10,
      borderRadius: radius.md,
    },
    rowOn: { backgroundColor: colors.surfaceRaised },
    name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
    nameMuted: { color: colors.textTertiary || colors.textSecondary },
    check: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.primary },
    stateWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    stateText: { fontSize: 12, color: colors.textSecondary },
    initial: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initialText: { color: colors.text, fontWeight: '700', fontSize: 16 },
    rowBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.white,
      borderRadius: radius.button,
      paddingHorizontal: 14,
      height: 34,
      minWidth: 88,
    },
    rowBtnText: { color: '#000000', fontSize: 13, fontWeight: '700' },
    rowBtnQuiet: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.button,
      paddingHorizontal: 14,
      height: 34,
      minWidth: 88,
    },
    rowBtnQuietText: { color: colors.text, fontSize: 13, fontWeight: '700' },
    connectCard: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      padding: 18,
      marginTop: 6,
    },
    connectIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    connectTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    connectBody: { fontSize: 14, color: colors.textSecondary, marginTop: 4, lineHeight: 20 },
    connectBtn: {
      marginTop: 14,
      alignSelf: 'flex-start',
      backgroundColor: colors.white,
      borderRadius: radius.button,
      paddingHorizontal: 18,
      height: 42,
      justifyContent: 'center',
    },
    connectBtnText: { color: '#000000', fontSize: 14, fontWeight: '700' },
    submit: {
      marginTop: 12,
      backgroundColor: colors.white,
      borderRadius: radius.button,
      height: 54,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitDisabled: { backgroundColor: colors.surfaceRaised },
    submitText: { color: '#000000', fontSize: 16, fontWeight: '700' },
    submitTextDisabled: { color: colors.textTertiary || colors.textSecondary },
    sentWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 12,
    },
    entryIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entryTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    entrySub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  });
