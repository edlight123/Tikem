import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Check, Search, UserPlus, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useSocialFlags } from '../lib/socialFlags';
import { radius, spacing } from '../theme/tokens';
import { fetchInvitePicker, sendInvites, type InvitePickerFriend } from '../lib/api/invites';
import PersonAvatar from './PersonAvatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppAlert } from './AppAlert';

const MAX_SELECTED = 20;

/**
 * "Invite friends" picker (web lib/invites): the viewer's ACCEPTED connections,
 * searchable by name, multi-select, send. A friend who is already invited or
 * going shows a dot + label; one who cannot be invited (for any reason, a mute
 * included) just reads "Can't invite".
 */
export function InviteFriendsSheet({
  visible,
  eventId,
  onClose,
}: {
  visible: boolean;
  eventId: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<InvitePickerFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setFriends(null);
    setFailed(false);
    setSelected(new Set());
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
    return () => {
      active = false;
    };
  }, [visible, eventId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (friends || []).filter((f) => !q || f.displayName.toLowerCase().includes(q));
  }, [friends, query]);

  const toggle = (uid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else if (next.size < MAX_SELECTED) next.add(uid);
      return next;
    });

  const send = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    const result = await sendInvites(eventId, Array.from(selected));
    setSending(false);
    if (!result.ok) {
      if (result.reason === 'limit') showAlert(t('invites.limitTitle'), t('invites.limitBody'));
      else showAlert(t('invites.errorTitle'), t('invites.errorBody'));
      return;
    }
    onClose();
    showAlert(t('invites.sentTitle'), t('invites.sentBody'));
  };

  const stateLabel = (s: InvitePickerFriend['state']) =>
    s === 'invited' ? t('invites.stateInvited') : s === 'going' ? t('invites.stateGoing') : t('invites.stateUnavailable');

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
              <Text style={styles.title}>{t('invites.pickerTitle').toLowerCase()}</Text>
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
            <Text style={styles.subtitle}>{t('invites.pickerSubtitle')}</Text>

            <View style={styles.searchBox}>
              <Search size={18} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('invites.search')}
                placeholderTextColor={colors.textTertiary || colors.textSecondary}
                selectionColor={colors.primary}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* minHeight: the sheet sizes to content, and the scroll view used to
                shrink to a sliver (one half-visible row behind the button). */}
            <ScrollView
              style={[styles.list, { minHeight: Math.min(Math.max(filtered.length, 1) * 64 + 8, 320) }]}
              keyboardShouldPersistTaps="handled"
            >
              {friends === null ? (
                <ActivityIndicator style={{ marginTop: 24 }} color={colors.textSecondary} />
              ) : failed ? (
                <Text style={styles.empty}>{t('invites.loadError')}</Text>
              ) : friends.length === 0 ? (
                <Text style={styles.empty}>{t('invites.empty')}</Text>
              ) : filtered.length === 0 ? (
                <Text style={styles.empty}>{t('invites.noMatch')}</Text>
              ) : (
                <View>
                  {filtered.map((f) => {
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
                  })}
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.submit, (selected.size === 0 || sending) && styles.submitDisabled]}
              onPress={send}
              disabled={selected.size === 0 || sending}
              accessibilityRole="button"
            >
              {sending ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <Text style={[styles.submitText, selected.size === 0 && styles.submitTextDisabled]}>
                  {selected.size === 0
                    ? t('invites.selectFriends')
                    : t('invites.sendCount', { count: selected.size })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * The event page entry point: a filled row that opens the picker. Signed-in
 * only, behind config/auth.invites (the server enforces it again).
 */
export default function InviteFriendsRow({ eventId, invitable = true }: { eventId: string; invitable?: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const flags = useSocialFlags();
  const [open, setOpen] = useState(false);
  const styles = getStyles(colors);
  if (!flags.invites || !user || !eventId || !invitable) return null;
  return (
    <>
      <TouchableOpacity
        style={styles.entry}
        onPress={() => setOpen(true)}
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
      <InviteFriendsSheet visible={open} eventId={eventId} onClose={() => setOpen(false)} />
    </>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheetWrap: { width: '100%' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      maxHeight: '88%',
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // Editorial sheet title, lowercased at the call site (house voice).
    title: { fontFamily: 'InstrumentSerif_400Regular', fontSize: 30, lineHeight: 34, color: colors.text },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, lineHeight: 19 },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 12 : 4,
      marginTop: 18,
    },
    searchInput: { flex: 1, fontSize: 16, color: colors.text },
    list: { marginTop: 10, maxHeight: 420 },
    empty: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginVertical: 28, lineHeight: 20 },
    // Borderless rows; a selected friend lifts one fill step instead of
    // getting a divider-boxed card.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
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
    submit: {
      marginTop: 16,
      backgroundColor: colors.white,
      borderRadius: radius.button,
      height: 54,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitDisabled: { backgroundColor: colors.surfaceRaised },
    submitText: { color: '#000000', fontSize: 16, fontWeight: '700' },
    submitTextDisabled: { color: colors.textTertiary || colors.textSecondary },
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 12,
    },
    entryIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    entryTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    entrySub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  });
