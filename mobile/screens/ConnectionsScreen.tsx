import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Users, Search, Phone, Inbox, Send, Share2, UserPlus } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import ConnectButton from '../components/ConnectButton';
import VerifiedBadge from '../components/VerifiedBadge';
import EmptyState from '../components/EmptyState';
import SectionHeader from '../components/SectionHeader';
import { suggestionReasonLabel } from '../components/PeopleYouMayKnowRail';
import { useSocialFlags } from '../lib/socialFlags';
import { requestPhonePrompt, usePhonePromptAvailable } from '../lib/phonePrompt';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { PeopleRowsSkeleton } from '../components/Skeleton';
import InviteContactsCard, { type DeviceContact } from '../components/InviteContactsCard';
import { useAppAlert } from '../components/AppAlert';
import {
  fetchConnections,
  searchUsers,
  matchContacts,
  fetchFriendSuggestions,
  type ConnectionsOverview,
  type UserSearchResult,
} from '../lib/api/social';
import { fetchInviteLink } from '../lib/api/invites';
import type { PublicUserSummary, FriendshipState, ContactMatch, FriendSuggestion } from '../types/social';

type Tab = 'friends' | 'requests' | 'find';

function Avatar({ user, colors, size = 44 }: { user: PublicUserSummary; colors: any; size?: number }) {
  const initial = (user.displayName || 'U').charAt(0).toUpperCase();
  if (user.photoURL) {
    return <Image source={{ uri: user.photoURL }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.4 }}>{initial}</Text>
    </View>
  );
}

function PersonRow({
  user,
  state,
  colors,
  onOpen,
  onChange,
  onRequireAuth,
  subtitle,
}: {
  user: PublicUserSummary;
  state: FriendshipState;
  colors: any;
  onOpen: (uid: string) => void;
  onChange?: (s: FriendshipState) => void;
  onRequireAuth?: () => void;
  /** e.g. why a suggestion is shown ("3 mutual friends"). */
  subtitle?: string;
}) {
  const styles = getStyles(colors);
  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.rowMain} onPress={() => onOpen(user.uid)} activeOpacity={0.7}>
        <Avatar user={user} colors={colors} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {user.displayName}
          </Text>
          {!!subtitle && (
            <Text style={styles.rowSub} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {user.isVerified && <VerifiedBadge size="small" showLabel style={styles.rowVerified} />}
        </View>
      </TouchableOpacity>
      <ConnectButton
        targetUserId={user.uid}
        initialState={state}
        size="sm"
        onChange={onChange}
        onRequireAuth={onRequireAuth}
      />
    </View>
  );
}

export default function ConnectionsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useI18n();
  // The title bar is a blurred overlay now, so the tabs beneath it carry its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();

  // Arriving from Discover's "Sync contacts" CTA jumps straight to the Find tab
  // and auto-starts the contact sync (feedback: don't make me tap twice).
  const autoSync = route?.params?.autoSync === true;
  // Callers (e.g. the Profile stats) can request an initial tab.
  const initialTab: Tab = autoSync
    ? 'find'
    : (['friends', 'requests', 'find'] as const).includes(route?.params?.initialTab)
      ? route.params.initialTab
      : 'friends';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [overview, setOverview] = useState<ConnectionsOverview>({ friends: [], incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadOverview = useCallback(async () => {
    const data = await fetchConnections();
    setOverview(data);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const data = await fetchConnections();
      if (active) {
        setOverview(data);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOverview();
    setRefreshing(false);
  }, [loadOverview]);

  const openProfile = (uid: string) => navigation.navigate('OrganizerProfile', { organizerId: uid });

  const goToLogin = () => navigation.navigate('Auth');

  return (
    // Plain View, not a SafeAreaView: 'top' was its only edge, and
    // OverlayHeader pays the notch inset itself so the chrome reaches
    // behind the status bar.
    <View style={styles.container}>
      {/* Header */}
      <OverlayHeader onHeight={onHeaderHeight} style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={16}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('connections.title')}</Text>
        <View style={{ width: 26 }} />
      </OverlayHeader>

      {/* Tabs — the header floats above them, so they reserve its height. */}
      <View style={[styles.tabs, { marginTop: headerH }]}>
        <TabBtn label={t('connections.tabs.friends')} count={overview.friends.length} active={tab === 'friends'} onPress={() => setTab('friends')} colors={colors} />
        <TabBtn label={t('connections.tabs.requests')} count={overview.incoming.length} highlight active={tab === 'requests'} onPress={() => setTab('requests')} colors={colors} />
        <TabBtn label={t('connections.tabs.find')} active={tab === 'find'} onPress={() => setTab('find')} colors={colors} />
      </View>

      {loading ? (
        <PeopleRowsSkeleton />
      ) : tab === 'find' ? (
        <FindTab
          colors={colors}
          onOpen={openProfile}
          onChange={loadOverview}
          onRequireAuth={goToLogin}
          insets={insets}
          autoSync={autoSync}
          inviteEventId={typeof route?.params?.inviteEventId === 'string' ? route.params.inviteEventId : null}
          inviteEventTitle={typeof route?.params?.inviteEventTitle === 'string' ? route.params.inviteEventTitle : null}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {tab === 'friends' && (
            <FriendsTab overview={overview} colors={colors} onOpen={openProfile} onChange={loadOverview} onRequireAuth={goToLogin} />
          )}
          {tab === 'requests' && (
            <RequestsTab overview={overview} colors={colors} onOpen={openProfile} onChange={loadOverview} onRequireAuth={goToLogin} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TabBtn({
  label,
  count,
  highlight,
  active,
  onPress,
  colors,
}: {
  label: string;
  count?: number;
  highlight?: boolean;
  active: boolean;
  onPress: () => void;
  colors: any;
}) {
  const styles = getStyles(colors);
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
      {count ? (
        <View style={[styles.badge, highlight && { backgroundColor: colors.error }]}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function FriendsTab({ overview, colors, onOpen, onChange, onRequireAuth }: any) {
  const styles = getStyles(colors);
  const { t } = useI18n();
  if (overview.friends.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('connections.friends.emptyTitle')}
        subtitle={t('connections.friends.emptySubtitle')}
      />
    );
  }
  return (
    <View style={styles.card}>
      {overview.friends.map((f: PublicUserSummary, i: number) => (
        <View key={f.uid} style={i > 0 ? styles.divider : undefined}>
          <PersonRow user={f} state="friends" colors={colors} onOpen={onOpen} onChange={onChange} onRequireAuth={onRequireAuth} />
        </View>
      ))}
    </View>
  );
}

function RequestsTab({ overview, colors, onOpen, onChange, onRequireAuth }: any) {
  const styles = getStyles(colors);
  const { t } = useI18n();
  const { incoming, outgoing } = overview;
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t('connections.requests.emptyTitle')}
        subtitle={t('connections.requests.emptySubtitle')}
      />
    );
  }
  return (
    <View>
      {incoming.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <View style={styles.sectionLabelRow}>
            <Inbox size={15} color={colors.textSecondary} />
            <Text style={styles.sectionLabel}>{t('connections.requests.received')}</Text>
          </View>
          <View style={styles.card}>
            {incoming.map((u: PublicUserSummary, i: number) => (
              <View key={u.uid} style={i > 0 ? styles.divider : undefined}>
                <PersonRow user={u} state="request_received" colors={colors} onOpen={onOpen} onChange={onChange} onRequireAuth={onRequireAuth} />
              </View>
            ))}
          </View>
        </View>
      )}
      {outgoing.length > 0 && (
        <View>
          <View style={styles.sectionLabelRow}>
            <Send size={15} color={colors.textSecondary} />
            <Text style={styles.sectionLabel}>{t('connections.requests.sent')}</Text>
          </View>
          <View style={styles.card}>
            {outgoing.map((u: PublicUserSummary, i: number) => (
              <View key={u.uid} style={i > 0 ? styles.divider : undefined}>
                <PersonRow user={u} state="request_sent" colors={colors} onOpen={onOpen} onChange={onChange} onRequireAuth={onRequireAuth} />
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function FindTab({ colors, onOpen, onChange, onRequireAuth, insets, autoSync, inviteEventId, inviteEventTitle }: any) {
  const styles = getStyles(colors);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [contactMatches, setContactMatches] = useState<ContactMatch[] | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  // The synced contacts themselves, kept on the phone for "Invite to Tikèm"
  // (config/auth.invites). Never sent anywhere.
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);

  // People you may know (config/auth.friend_suggestions; enforced server-side too).
  const flags = useSocialFlags();
  const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
  useEffect(() => {
    if (!flags.friendSuggestions) {
      setSuggestions([]);
      return;
    }
    let active = true;
    fetchFriendSuggestions().then((list) => {
      if (active) setSuggestions(list);
    });
    return () => {
      active = false;
    };
  }, [flags.friendSuggestions]);

  // With the "add your number" prompt live, contact matching needs a verified
  // phone first: route through the sheet, then sync once it is linked. With
  // the prompt off (no WhatsApp provider yet) the old direct flow stays.
  const needsPhone = usePhonePromptAvailable();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        setResults(await searchUsers(query));
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const syncContacts = useCallback(async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        showAlert(
          t('connections.find.permissionTitle'),
          t('connections.find.permissionBody')
        );
        return;
      }
      setContactLoading(true);
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      const phones: string[] = [];
      const list: DeviceContact[] = [];
      data.forEach((c, i) => {
        (c.phoneNumbers || []).forEach((p) => {
          if (p.number) phones.push(p.number);
        });
        const first = (c.phoneNumbers || []).find((p) => p.number)?.number;
        const name = String(c.name || '').trim();
        if (first && name) list.push({ id: String(c.id || i), name, phone: first });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setDeviceContacts(list);
      if (phones.length === 0) {
        showAlert(t('connections.find.noNumbersTitle'), t('connections.find.noNumbersBody'));
        setContactMatches([]);
        return;
      }
      setContactMatches(await matchContacts(phones));
    } catch (e: any) {
      showAlert(t('connections.find.errorTitle'), e?.message || t('connections.find.errorBody'));
    } finally {
      setContactLoading(false);
    }
  }, [t]);

  const startSync = useCallback(() => {
    if (needsPhone) {
      requestPhonePrompt({ trigger: 'find_friends', onLinked: () => syncContacts() });
      return;
    }
    syncContacts();
  }, [needsPhone, syncContacts]);

  const [sharingInvite, setSharingInvite] = useState(false);
  const shareAppInvite = useCallback(async () => {
    setSharingInvite(true);
    try {
      const link = await fetchInviteLink();
      if (!link) {
        showAlert(t('invites.errorTitle'), t('invites.linkError'));
        return;
      }
      await Share.share({ message: t('invites.messageApp', { link }) });
    } catch {
      // Share sheet dismissed or unavailable: nothing to report.
    } finally {
      setSharingInvite(false);
    }
  }, [showAlert, t]);

  // Auto-start the sync once when arriving via Discover's "Sync contacts" CTA.
  const didAutoSync = useRef(false);
  useEffect(() => {
    if (autoSync && !didAutoSync.current) {
      didAutoSync.current = true;
      startSync();
    }
  }, [autoSync, startSync]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Search */}
      <View style={styles.searchBox}>
        <Search size={20} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('connections.find.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={colors.textSecondary} />}
      </View>

      {results.length > 0 && (
        <View style={[styles.card, { marginTop: 12 }]}>
          {results.map((r, i) => (
            <View key={r.uid} style={i > 0 ? styles.divider : undefined}>
              <PersonRow user={r} state={r.friendship} colors={colors} onOpen={onOpen} onChange={onChange} onRequireAuth={onRequireAuth} />
            </View>
          ))}
        </View>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <Text style={styles.noResults}>{t('connections.find.noResults').replace('{query}', query)}</Text>
      )}

      {suggestions.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <SectionHeader title={t('friendSuggestions.title')} />
          <View style={styles.card}>
            {suggestions.map((s, i) => (
              <View key={s.uid} style={i > 0 ? styles.divider : undefined}>
                <PersonRow
                  user={s}
                  state="none"
                  subtitle={suggestionReasonLabel(t, s)}
                  colors={colors}
                  onOpen={onOpen}
                  onChange={onChange}
                  onRequireAuth={onRequireAuth}
                />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Contact sync */}
      <View style={styles.contactCard}>
        <View style={styles.contactHeader}>
          <View style={styles.contactIcon}>
            <Phone size={20} color={colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>{t('connections.find.contactTitle')}</Text>
            <Text style={styles.contactSub}>
              {needsPhone ? t('friendSuggestions.contactsNeedsPhone') : t('connections.find.contactSub')}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.syncBtn} onPress={startSync} disabled={contactLoading} activeOpacity={0.85}>
          {contactLoading ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <>
              <UserPlus size={16} color="#000000" />
              <Text style={styles.syncBtnText}>{t('connections.find.syncContacts')}</Text>
            </>
          )}
        </TouchableOpacity>

        {contactMatches !== null && (
          <View style={{ marginTop: 12 }}>
            {contactMatches.length === 0 ? (
              <Text style={styles.noResults}>{t('connections.find.noContactMatches')}</Text>
            ) : (
              <View>
                <Text style={styles.sectionLabel}>{t('connections.find.onTikem').replace('{count}', String(contactMatches.length))}</Text>
                <View style={[styles.card, { marginTop: 8 }]}>
                  {contactMatches.map((m, i) => (
                    <View key={m.uid} style={i > 0 ? styles.divider : undefined}>
                      <PersonRow user={m} state={m.friendship} colors={colors} onOpen={onOpen} onChange={onChange} onRequireAuth={onRequireAuth} />
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Invite friends to Tikèm: the personal link (config/auth.invites).
          Hidden entirely while the switch is off, never a dead button. */}
      {flags.invites && (
        <TouchableOpacity
          style={styles.contactCard}
          onPress={shareAppInvite}
          disabled={sharingInvite}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <View style={styles.contactHeader}>
            <View style={styles.contactIcon}>
              {sharingInvite ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Share2 size={20} color={colors.textSecondary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>{t('invites.shareInviteLink')}</Text>
              <Text style={styles.contactSub}>{t('invites.appLinkSub')}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {flags.invites && contactMatches !== null && (
        <InviteContactsCard
          contacts={deviceContacts}
          matchedNames={contactMatches.map((m) => m.displayName)}
          eventId={inviteEventId}
          eventTitle={inviteEventTitle}
        />
      )}
    </ScrollView>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // Overlay chrome (OverlayHeader owns the row layout, the safe-area top
    // padding, the blur backdrop and the absolute placement) — only the row's
    // own geometry is ours. No paddingTop here: the screen root is a plain View
    // (not a SafeAreaView) precisely so OverlayHeader can pay the notch itself.
    // No fill and no hairline either: they would paint over the blur.
    topBar: {
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingBottom: 10,
    },
    backBtn: {
      padding: 2,
    },
    topTitle: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: -0.5,
      color: colors.text,
    },
    tabs: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: colors.borderLight,
      borderRadius: radius.md,
      padding: 4,
    },
    tabBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 9,
    },
    tabBtnActive: {
      backgroundColor: colors.surfaceRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    tabBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    tabBtnTextActive: {
      color: colors.primary,
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: colors.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
    // Elevation, not borders (POSH §1).
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowInfo: {
      flex: 1,
    },
    rowName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowVerified: {
      marginTop: 3,
    },
    rowSub: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    sectionLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
    },
    noResults: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 14,
    },
    contactCard: {
      marginTop: 20,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 16,
    },
    contactHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    contactIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    contactSub: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
      lineHeight: 18,
    },
    // White pill primary (POSH §2.2) — not a teal fill.
    syncBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.white,
      borderRadius: radius.md,
      paddingVertical: 12,
      marginTop: 14,
    },
    syncBtnText: {
      color: '#000000',
      fontSize: 14,
      fontWeight: '700',
    },
  });
