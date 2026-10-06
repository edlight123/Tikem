import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Search, Send } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';
import { fetchInviteLink } from '../lib/api/invites';
import { openWhatsAppInvite } from '../lib/inviteLink';
import { useAppAlert } from './AppAlert';
import SectionHeader from './SectionHeader';

export interface DeviceContact {
  id: string;
  name: string;
  phone: string;
}

/** Rendered at most; the search box reaches the rest. */
const MAX_ROWS = 50;

/**
 * "Invite to Tikèm" under the contact sync (web lib/invites): the synced
 * contacts who did not match anyone on Tikèm, each with an Invite button that
 * opens WhatsApp with the sharer's personal link (falls back to the share
 * sheet). Contacts never leave the phone here: only the link is fetched.
 *
 * Which contacts matched is not something the server says (it returns people,
 * not numbers), so a contact whose name equals a matched person's name is
 * left out; anyone else is offered.
 */
export default function InviteContactsCard({
  contacts,
  matchedNames,
  eventId,
  eventTitle,
}: {
  contacts: DeviceContact[];
  matchedNames: string[];
  eventId?: string | null;
  eventTitle?: string | null;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const linkRef = useRef<string | null>(null);

  const candidates = useMemo(() => {
    const matched = new Set(matchedNames.map((n) => n.trim().toLowerCase()));
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => !matched.has(c.name.trim().toLowerCase()))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, MAX_ROWS);
  }, [contacts, matchedNames, query]);

  if (contacts.length === 0) return null;

  const invite = async (c: DeviceContact) => {
    if (busyId) return;
    setBusyId(c.id);
    try {
      const link = linkRef.current || (await fetchInviteLink(eventId || null));
      if (!link) {
        showAlert(t('invites.errorTitle'), t('invites.linkError'));
        return;
      }
      linkRef.current = link;
      const text = eventTitle
        ? t('invites.messageEvent', { event: eventTitle, link })
        : t('invites.messageApp', { link });
      await openWhatsAppInvite(text, c.phone);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ marginTop: 20 }}>
      <SectionHeader title={t('invites.contactsTitle')} subtitle={t('invites.contactsSub')} subtitleLines={2} />
      <View style={styles.searchBox}>
        <Search size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('invites.contactsSearch')}
          placeholderTextColor={colors.textTertiary || colors.textSecondary}
          selectionColor={colors.primary}
          style={styles.searchInput}
          autoCorrect={false}
        />
      </View>
      {candidates.length > 0 && (
        <View style={styles.card}>
          {candidates.map((c, i) => (
            <View key={c.id} style={[styles.row, i > 0 && styles.divider]}>
              <View style={styles.initial}>
                <Text style={styles.initialText}>{(c.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {c.name}
              </Text>
              <TouchableOpacity
                style={styles.inviteBtn}
                onPress={() => invite(c)}
                disabled={!!busyId}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`${t('invites.invite')} ${c.name}`}
              >
                {busyId === c.id ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <>
                    <Send size={14} color="#000000" />
                    <Text style={styles.inviteText}>{t('invites.invite')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 10 : 2,
      marginBottom: 10,
    },
    searchInput: { flex: 1, fontSize: 16, color: colors.text },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    initial: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initialText: { color: colors.text, fontWeight: '700', fontSize: 16 },
    name: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
    inviteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.white,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 84,
      justifyContent: 'center',
    },
    inviteText: { color: '#000000', fontSize: 13, fontWeight: '700' },
  });
