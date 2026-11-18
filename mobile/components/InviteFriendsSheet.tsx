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
  useWindowDimensions,
  Animated,
} from 'react-native';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { BookUser, Link2, Search, Share as ShareIcon, User, UserPlus, X } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useSocialFlags } from '../lib/socialFlags';
import { radius, font } from '../theme/tokens';
import { fetchInviteLink, fetchInvitePicker, sendInvites, type InvitePickerFriend } from '../lib/api/invites';
import { sendConnectionRequest } from '../lib/api/social';
import {
  contactsPermission,
  requestContactsPermission,
  syncContacts,
  updateCachedMatch,
  type DeviceContact,
} from '../lib/contactSync';
import { contactPhoneE164, matchedContactIds, openWhatsAppInvite } from '../lib/inviteLink';
import { requestPhonePrompt, usePhonePromptAvailable } from '../lib/phonePrompt';
import type { ContactMatch } from '../types/social';
import PersonAvatar from './PersonAvatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from './AppAlert';

const MAX_SELECTED = 20;
/** Contacts rendered at most; the search box reaches the rest. */
const MAX_CONTACT_ROWS = 60;
/** Invite taps this close together leave as one sendInvites batch. */
const INVITE_BATCH_MS = 700;

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

const WHATSAPP_GREEN = '#25D366';

/** A real first letter ("Mom" → M), or null for "# Mom" / "09-Daana". */
function firstLetter(name: string): string | null {
  const m = cleanName(name).match(/^\p{L}/u);
  return m ? m[0].toUpperCase() : null;
}
/** "# Mom" → "Mom", "09-Daana Henry" → "Daana Henry": address-book sort prefixes off. */
function cleanName(name: string): string {
  const cleaned = (name || '').replace(/^[^\p{L}]+/u, '').trim();
  return cleaned || (name || '').trim();
}
/**
 * "+15085550101" → "+1 508 555 0101", "+50937000001" → "+509 3700 0001",
 * "+33612345678" → "+33 6 12 34 56 78". Display only; anything unrecognised
 * is shown as the address book has it.
 */
function prettyPhone(raw: string): string {
  const p = (raw || '').replace(/[^\d+]/g, '');
  let m;
  if ((m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/))) return `+1 ${m[1]} ${m[2]} ${m[3]}`;
  if ((m = p.match(/^\+509(\d{4})(\d{4})$/))) return `+509 ${m[1]} ${m[2]}`;
  if ((m = p.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/))) return `+33 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`;
  return raw;
}
function startsWithLetter(name: string): boolean {
  return /^\p{L}/u.test((name || '').trim());
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
 * "Invite friends" (web lib/invites), after Posh's share sheet (owner,
 * 2026-11-18: "make the contact sheet also as premium"):
 * - a serif title and the event line, a square close,
 * - search beside a contacts button (the contact-matching flow starts there),
 * - one "on tikèm" list: ACCEPTED friends with a compact white Invite each
 *   (invited / going / can't invite read as a dot + label), then contacts
 *   already on Tikèm with an Add,
 * - "from your contacts": everyone else, invited on WhatsApp with the link,
 * - a fixed bottom bar: Share to (the system sheet with the whole message)
 *   and Copy link (the system sheet with just the link: no clipboard module
 *   ships in the binary, and the share sheet has a real Copy).
 * Invite taps made in quick succession go out as one batch (sendInvites with
 * every id, still capped at MAX_SELECTED), so multi-select survives as taps.
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
  const { height: windowHeight } = useWindowDimensions();
  const swipe = useSwipeToClose(onClose, visible);
  const needsPhone = usePhonePromptAvailable();
  const [friends, setFriends] = useState<InvitePickerFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactsState>({ kind: 'checking' });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const linkRef = useRef<string | null>(null);
  const uid = user?.uid || '';

  // Invite taps queue here and leave together a moment after the last one.
  const queueRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushInvites = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const ids = Array.from(queueRef.current);
    queueRef.current = new Set();
    if (ids.length === 0) return;
    const result = await sendInvites(eventId, ids);
    if (!result.ok) {
      // Put the rows back so they can be tapped again.
      const back = new Set(ids);
      setFriends((list) => (list ? list.map((f) => (back.has(f.uid) ? { ...f, state: 'available' } : f)) : list));
      if (result.reason === 'limit') showAlert(t('invites.limitTitle'), t('invites.limitBody'));
      else showAlert(t('invites.errorTitle'), t('invites.errorBody'));
    }
  }, [eventId, showAlert, t]);

  // Whatever is queued goes out when the sheet closes (button, backdrop or swipe).
  const flushRef = useRef(flushInvites);
  flushRef.current = flushInvites;
  useEffect(() => {
    if (!visible) flushRef.current();
  }, [visible]);
  useEffect(() => () => void flushRef.current(), []);

  const inviteFriend = (id: string) => {
    if (queueRef.current.size >= MAX_SELECTED) flushInvites();
    queueRef.current.add(id);
    setFriends((list) => (list ? list.map((f) => (f.uid === id ? { ...f, state: 'invited' } : f)) : list));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), INVITE_BATCH_MS);
  };

  const loadContacts = useCallback(
    async (force = false) => {
      setContacts({ kind: 'loading' });
      try {
        // Paint the device list the instant it is read; the "on Tikèm" matches
        // (a network round-trip over every number) fill in a moment later
        // instead of blocking the whole list behind a spinner.
        const res = await syncContacts(uid, {
          force,
          onContacts: (deviceContacts) =>
            setContacts({ kind: 'ready', contacts: deviceContacts, matches: [] }),
        });
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

  /** The contacts button: start matching, re-read, or send to Settings. */
  const onContactsButton = () => {
    if (contacts.kind === 'checking' || contacts.kind === 'loading') return;
    if (contacts.kind === 'denied') Linking.openSettings().catch(() => {});
    else if (contacts.kind === 'ready') loadContacts(true);
    else connectContacts();
  };

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setFriends(null);
    setFailed(false);
    setQuery('');
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

  // Contacts split: people on Tikèm who are not friends yet (add them), and
  // everyone else (invite them). Friends already show in the list above.
  const { people, others } = useMemo(() => {
    if (contacts.kind !== 'ready') return { people: [] as ContactMatch[], others: [] as DeviceContact[] };
    const matched = matchedContactIds(contacts.contacts, contacts.matches);
    return {
      people: contacts.matches
        .filter((m) => m.friendship !== 'friends' && m.friendship !== 'self')
        .filter((m) => !q || m.displayName.toLowerCase().includes(q)),
      // Names that start with a letter first; "# Mom", "09-Daana" after.
      others: contacts.contacts
        .filter((c) => !matched.has(c.id))
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!firstLetter(a.name)) - Number(!firstLetter(b.name)))
        .slice(0, MAX_CONTACT_ROWS),
    };
  }, [contacts, q]);

  /** The message every share path sends: the event, when and where, the personal link. */
  const getLink = async (): Promise<string | null> => {
    const link = linkRef.current || (await fetchInviteLink(eventId));
    if (!link) {
      showAlert(t('invites.errorTitle'), t('invites.linkError'));
      return null;
    }
    linkRef.current = link;
    return link;
  };
  const message = async (): Promise<string | null> => {
    const link = await getLink();
    if (!link) return null;
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

  /** Share to: the whole message. Copy link: just the link (the sheet has Copy). */
  const shareOut = (what: 'message' | 'link') =>
    withBusy(`share:${what}`, async () => {
      const text = what === 'message' ? await message() : await getLink();
      if (!text) return;
      try {
        await Share.share({ message: text });
      } catch {
        // dismissed
      }
    });

  const inviteContact = (c: DeviceContact) =>
    withBusy(`contact:${c.id}`, async () => {
      const text = await message();
      if (!text) return;
      // No WhatsApp: openWhatsAppInvite falls back to the share sheet (Messages).
      await openWhatsAppInvite(text, contactPhoneE164(c.phone) || c.phone);
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
  const showOnTikem = friends === null || failed || hasFriends || people.length > 0;

  /** Dot + label, never a filled status pill. */
  const status = (label: string, accent = false) => (
    <View style={styles.stateWrap}>
      <View style={[styles.dot, { backgroundColor: accent ? colors.primary : colors.textTertiary }]} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <Animated.View
            style={[
              styles.sheet,
              swipe.sheetStyle,
              {
                // Sized to its content, capped below the status bar. The cap is
                // a number, not '90%': a percentage height inside the auto-height
                // KeyboardAvoidingView has nothing to resolve against.
                maxHeight: windowHeight - insets.top - 24,
                paddingBottom: Math.max(insets.bottom, 12) + 4,
              },
            ]}
          >
            {/* Paints below the sheet's edge: on device the sheet stopped short
                of the screen bottom and the page showed through the gap. */}
            <View pointerEvents="none" style={styles.bottomFill} />
            <View {...swipe.panHandlers}>
              <View style={styles.grabber} />
              <View style={styles.header}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title}>{t('invites.pickerTitle').toLowerCase()}</Text>
                  {!!event?.title && (
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {[event.title, event.details].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={10}
                  style={styles.close}
                  accessibilityRole="button"
                  accessibilityLabel={t('invites.close')}
                >
                  <X size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Search size={17} color={colors.textSecondary} />
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
              <TouchableOpacity
                style={styles.squareBtn}
                onPress={onContactsButton}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={contacts.kind === 'denied' ? t('invites.openSettings') : t('invites.contactsConnect')}
              >
                {contacts.kind === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <BookUser size={18} color={colors.text} />
                )}
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {showOnTikem && (
                <>
                  <Text style={styles.section}>{t('invites.sectionFriends').toLowerCase()}</Text>
                  {friends === null ? (
                    <ActivityIndicator style={{ marginVertical: 18 }} color={colors.textSecondary} />
                  ) : failed ? (
                    <Text style={styles.empty}>{t('invites.loadError')}</Text>
                  ) : hasFriends && filteredFriends.length === 0 && people.length === 0 ? (
                    <Text style={styles.empty}>{t('invites.noMatch')}</Text>
                  ) : null}
                  {filteredFriends.map((f) => {
                    const available = f.state === 'available';
                    return (
                      <View key={f.uid} style={styles.row}>
                        <PersonAvatar user={f} size={44} />
                        <Text style={[styles.name, f.state === 'unavailable' && styles.nameMuted]} numberOfLines={1}>
                          {f.displayName}
                        </Text>
                        {available ? (
                          <TouchableOpacity
                            style={styles.btnWhite}
                            onPress={() => inviteFriend(f.uid)}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('invites.invite')} ${f.displayName}`}
                          >
                            <Text style={styles.btnWhiteText}>{t('invites.invite')}</Text>
                          </TouchableOpacity>
                        ) : (
                          status(stateLabel(f.state), f.state === 'going')
                        )}
                      </View>
                    );
                  })}
                  {people.map((m) => (
                    <View key={m.uid} style={styles.row}>
                      <PersonAvatar user={m} size={44} />
                      <Text style={styles.name} numberOfLines={1}>
                        {m.displayName}
                      </Text>
                      {m.friendship === 'request_sent' ? (
                        status(t('invites.requested'))
                      ) : (
                        <TouchableOpacity
                          style={styles.btnWhite}
                          onPress={() => addPerson(m)}
                          disabled={!!busyKey}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('invites.addFriend')} ${m.displayName}`}
                        >
                          {busyKey === `person:${m.uid}` ? (
                            <ActivityIndicator size="small" color="#000000" />
                          ) : (
                            <Text style={styles.btnWhiteText}>{t('invites.addFriend')}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </>
              )}

              <Text style={[styles.section, showOnTikem && { marginTop: 14 }]}>
                {t('invites.sectionContacts').toLowerCase()}
              </Text>
              {contacts.kind === 'checking' || (contacts.kind === 'loading' && others.length === 0) ? (
                <ActivityIndicator style={{ marginVertical: 18 }} color={colors.textSecondary} />
              ) : contacts.kind === 'idle' || contacts.kind === 'denied' ? (
                // One row, not a card: the contacts button above does the same.
                <View style={styles.row}>
                  <View style={styles.initial}>
                    <BookUser size={18} color={colors.textSecondary} />
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {t('invites.contactsRow')}
                  </Text>
                  <TouchableOpacity
                    style={styles.btnWhite}
                    onPress={onContactsButton}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnWhiteText}>
                      {contacts.kind === 'denied' ? t('invites.settingsShort') : t('invites.connectShort')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : people.length === 0 && others.length === 0 ? (
                <Text style={styles.empty}>{q ? t('invites.contactsNoMatch') : t('invites.contactsAllDone')}</Text>
              ) : (
                others.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={styles.initial}>
                      {firstLetter(c.name) ? (
                        <Text style={styles.initialText}>{firstLetter(c.name)}</Text>
                      ) : (
                        <User size={18} color={colors.textSecondary} />
                      )}
                    </View>
                    <View style={styles.contactText}>
                      <Text style={styles.contactName} numberOfLines={1}>
                        {cleanName(c.name)}
                      </Text>
                      {c.phone ? (
                        <Text style={styles.contactSub} numberOfLines={1}>
                          {prettyPhone(c.phone)}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.btnRaised}
                      onPress={() => inviteContact(c)}
                      disabled={!!busyKey}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('invites.invite')} ${c.name}`}
                    >
                      {busyKey === `contact:${c.id}` ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <>
                          <WhatsAppGlyph size={14} color={WHATSAPP_GREEN} />
                          <Text style={styles.btnRaisedText}>{t('invites.invite')}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              )}
              <View style={{ height: 8 }} />
            </ScrollView>

            {/* Fixed bar, as on Posh: the raised Share to, a quiet Copy link. */}
            <View style={styles.bar}>
              <TouchableOpacity
                style={[styles.barBtn, styles.barBtnRaised]}
                onPress={() => shareOut('message')}
                disabled={!!busyKey}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {busyKey === 'share:message' ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <>
                    <ShareIcon size={16} color={colors.text} />
                    <Text style={styles.barText}>{t('invites.shareTo')}</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.barBtn}
                onPress={() => shareOut('link')}
                disabled={!!busyKey}
                activeOpacity={0.6}
                accessibilityRole="button"
              >
                {busyKey === 'share:link' ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <>
                    <Link2 size={16} color={colors.text} />
                    <Text style={styles.barText}>{t('invites.copyLink')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
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
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={t('invites.inviteFriends')}
        hitSlop={8}
      >
        <UserPlus size={18} color={colors.text} />
        <Text style={styles.entryTitle}>{t('invites.inviteFriends')}</Text>
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
    // flexShrink so the keyboard's padding squeezes the sheet (and with it the
    // list) instead of pushing the header off the top of the screen.
    sheetWrap: { width: '100%', flexShrink: 1 },
    // Auto-height up to the cap set inline: a short list gets a short sheet,
    // a long one fills the cap and scrolls above the fixed bar.
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      flexShrink: 1,
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
      marginBottom: 12,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    // Editorial sheet title, lowercased at the call site (house voice).
    title: { fontFamily: font.serif, fontSize: 28, lineHeight: 32, color: colors.text },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    close: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 42,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
    squareBtn: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Grows with its rows, shrinks (and scrolls) once the sheet hits its cap.
    list: { flexGrow: 0, flexShrink: 1, marginTop: 6 },
    // Section label: the house serif, lowercased, small enough to sit above
    // a compact list.
    section: { fontFamily: font.serif, fontSize: 20, lineHeight: 24, color: colors.text, marginTop: 10, marginBottom: 2 },
    empty: { fontSize: 13, color: colors.textSecondary, marginVertical: 12, lineHeight: 18 },
    // 56pt rows: 44 avatar, name, one compact action on the right.
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 56 },
    name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: colors.text },
    nameMuted: { color: colors.textTertiary || colors.textSecondary },
    stateWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 72, justifyContent: 'flex-end' },
    dot: { width: 6, height: 6, borderRadius: 3 },
    stateText: { fontSize: 13, color: colors.textSecondary },
    initial: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initialText: { color: colors.text, fontWeight: '700', fontSize: 15 },
    // Compact white action, like the website's small buttons.
    btnWhite: {
      height: 34,
      minWidth: 72,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnWhiteText: { color: '#000000', fontSize: 13, fontWeight: '600' },
    // The contact rows' quieter twin: a raised fill with WhatsApp's mark.
    btnRaised: {
      flexDirection: 'row',
      gap: 6,
      height: 34,
      minWidth: 72,
      paddingHorizontal: 12,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnRaisedText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    contactText: { flex: 1, minWidth: 0, justifyContent: 'center' },
    contactName: { fontSize: 15, lineHeight: 19, fontWeight: '600', color: colors.text },
    contactSub: { fontSize: 13, lineHeight: 17, color: colors.textTertiary || colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
    bar: { flexDirection: 'row', gap: 10, paddingTop: 10 },
    barBtn: {
      flex: 1,
      height: 44,
      borderRadius: radius.button,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barBtnRaised: { backgroundColor: colors.surfaceRaised },
    barText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    // A quiet text row: icon + label, no fill, no tile.
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 10,
      paddingVertical: 12,
      marginTop: 4,
    },
    entryTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
