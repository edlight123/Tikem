// Per-event guest list: VIPs, press and friends the organizer lets in by name.
//
// Same data as the web page (app/organizer/events/[id]/guest-list): the
// events/{id}/guests sub-collection. It has no client Firestore rules, so every
// read and write goes through /api/organizer/events/{id}/guests (backendJson
// attaches the organizer's token). A guest added here shows on the web, and
// the reverse.

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, Search, Users, X } from 'lucide-react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatTriplet from '../../components/StatTriplet';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import FormSheet, { SheetInput, SheetLabel } from '../../components/organizer/FormSheet';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { getEventById } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';
import { colors as T, radius, spacing } from '../../theme/tokens';

type RouteParams = {
  OrganizerGuestList: {
    eventId: string;
  };
};

type Guest = {
  id: string;
  name: string;
  email: string;
  status: string;
  plus_one: boolean;
  invited_at: string | null;
  checked_in: boolean;
};

type Filter = 'all' | 'checked_in' | 'not_checked_in';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase() || '?';
}

export default function OrganizerGuestListScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerGuestList'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const { t } = useI18n();
  const showAlert = useAppAlert();

  const [eventTitle, setEventTitle] = useState('');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Sheet state. `editing` null + sheetOpen = adding a new guest.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Guest | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plusOne, setPlusOne] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [event, data] = await Promise.all([
        getEventById(eventId),
        backendJson<{ guests: Guest[] }>(`/api/organizer/events/${eventId}/guests`),
      ]);
      setEventTitle(event?.title || '');
      setGuests(data.guests || []);
    } catch {
      showAlert(t('common.error'), t('organizerGuestList.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [eventId, showAlert, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const checkedInCount = guests.filter((g) => g.checked_in).length;
  const headcount = guests.reduce((sum, g) => sum + (g.plus_one ? 2 : 1), 0);

  const visibleGuests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return guests.filter((g) => {
      if (q && !(g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q))) return false;
      if (filter === 'checked_in') return g.checked_in;
      if (filter === 'not_checked_in') return !g.checked_in;
      return true;
    });
  }, [guests, searchQuery, filter]);

  const statusLabel = (status: string) => {
    if (status === 'invited') return t('organizerGuestList.status.invited');
    if (status === 'accepted') return t('organizerGuestList.status.accepted');
    if (status === 'declined') return t('organizerGuestList.status.declined');
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setEmail('');
    setPlusOne(false);
    setCheckedIn(false);
    setFormError(null);
    setSheetOpen(true);
  };

  const openEdit = (g: Guest) => {
    setEditing(g);
    setName(g.name);
    setEmail(g.email);
    setPlusOne(g.plus_one);
    setCheckedIn(g.checked_in);
    setFormError(null);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
  };

  const serverError = (err: any, fallbackKey: string) => {
    if (err?.status === 409) return t('organizerGuestList.errors.duplicate');
    return t(fallbackKey);
  };

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setFormError(t('organizerGuestList.errors.nameRequired'));
      return;
    }
    if (!trimmedEmail) {
      setFormError(t('organizerGuestList.errors.emailRequired'));
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setFormError(t('organizerGuestList.errors.emailInvalid'));
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const data = await backendJson<{ guest: Guest }>(
          `/api/organizer/events/${eventId}/guests/${editing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: trimmedName,
              email: trimmedEmail,
              plus_one: plusOne,
              checked_in: checkedIn,
            }),
          }
        );
        setGuests((prev) => prev.map((g) => (g.id === editing.id ? data.guest : g)));
      } else {
        const data = await backendJson<{ guest: Guest }>(`/api/organizer/events/${eventId}/guests`, {
          method: 'POST',
          body: JSON.stringify({ name: trimmedName, email: trimmedEmail, plus_one: plusOne }),
        });
        setGuests((prev) => [data.guest, ...prev]);
      }
      setSheetOpen(false);
    } catch (err: any) {
      setFormError(serverError(err, 'organizerGuestList.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    if (!editing) return;
    const target = editing;
    showAlert(
      t('organizerGuestList.delete.title'),
      t('organizerGuestList.delete.message', { name: target.name || target.email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('organizerGuestList.delete.confirm'),
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await backendJson(`/api/organizer/events/${eventId}/guests/${target.id}`, {
                method: 'DELETE',
              });
              setGuests((prev) => prev.filter((g) => g.id !== target.id));
              setSheetOpen(false);
            } catch {
              setFormError(t('organizerGuestList.errors.deleteFailed'));
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  // Door-side quick toggle: optimistic, reverts if the write fails.
  const toggleCheckIn = async (g: Guest) => {
    if (pendingIds.has(g.id)) return;
    const next = !g.checked_in;
    setPendingIds((prev) => new Set(prev).add(g.id));
    setGuests((prev) => prev.map((x) => (x.id === g.id ? { ...x, checked_in: next } : x)));
    try {
      await backendJson(`/api/organizer/events/${eventId}/guests/${g.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ checked_in: next }),
      });
    } catch {
      setGuests((prev) => prev.map((x) => (x.id === g.id ? { ...x, checked_in: g.checked_in } : x)));
      showAlert(t('common.error'), t('organizerGuestList.errors.checkInFailed'));
    } finally {
      setPendingIds((prev) => {
        const copy = new Set(prev);
        copy.delete(g.id);
        return copy;
      });
    }
  };

  const renderGuest = ({ item }: { item: Guest }) => {
    const pending = pendingIds.has(item.id);
    return (
      <TouchableOpacity
        style={styles.guestCard}
        onPress={() => openEdit(item)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={t('organizerGuestList.editA11y', { name: item.name || item.email })}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(item.name, item.email)}</Text>
        </View>

        <View style={styles.guestBody}>
          <Text style={styles.guestName} numberOfLines={1}>
            {item.name || item.email}
          </Text>
          {!!item.email && !!item.name && (
            <Text style={styles.guestEmail} numberOfLines={1}>
              {item.email}
            </Text>
          )}
          <View style={styles.metaRow}>
            <View
              style={[
                styles.dot,
                { backgroundColor: item.checked_in ? colors.success : colors.textTertiary },
              ]}
            />
            <Text style={styles.metaText} numberOfLines={1}>
              {item.checked_in ? t('organizerGuestList.status.checkedIn') : statusLabel(item.status)}
              {item.plus_one ? `  ·  ${t('organizerGuestList.plusOne')}` : ''}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.checkButton, item.checked_in && styles.checkButtonOn, pending && styles.dimmed]}
          onPress={() => toggleCheckIn(item)}
          disabled={pending}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="switch"
          accessibilityState={{ checked: item.checked_in, disabled: pending }}
          accessibilityLabel={t('organizerGuestList.checkInA11y', { name: item.name || item.email })}
        >
          <Check
            size={18}
            strokeWidth={2.5}
            color={item.checked_in ? T.accent : colors.textTertiary}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const header = (
    <OrganizerScreenHeader
      title={t('organizerGuestList.title')}
      subtitle={eventTitle || undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH + spacing.lg, paddingHorizontal: spacing.lg }}>
          <Skeleton width="100%" height={92} radius={radius.lg} />
          <Skeleton width="100%" height={46} radius={radius.md} style={{ marginTop: spacing.lg }} />
          <Skeleton width="70%" height={34} radius={radius.button} style={{ marginTop: spacing.md }} />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={76} radius={radius.lg} style={{ marginTop: spacing.md }} />
          ))}
        </View>
      </View>
    );
  }

  const hasGuests = guests.length > 0;

  return (
    <View style={styles.container}>
      {header}

      <FlatList
        data={hasGuests ? visibleGuests : []}
        keyExtractor={(g) => g.id}
        renderItem={renderGuest}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerH + spacing.lg, paddingBottom: insets.bottom + (hasGuests ? 112 : 32) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} progressViewOffset={headerH} />
        }
        ListHeaderComponent={
          hasGuests ? (
            <View>
              <StatTriplet
                items={[
                  { label: t('organizerGuestList.stats.guests'), value: guests.length },
                  { label: t('organizerGuestList.stats.headcount'), value: headcount },
                  { label: t('organizerGuestList.stats.checkedIn'), value: checkedInCount },
                ]}
              />

              <View style={styles.searchField}>
                <Search size={18} color={colors.textTertiary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t('organizerGuestList.searchPlaceholder')}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('organizerGuestList.clearSearch')}
                  >
                    <X size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.tabsWrap}>
                <SegmentedTabs
                  value={filter}
                  onChange={(key) => setFilter(key as Filter)}
                  tabs={[
                    { key: 'all', label: t('organizerGuestList.filters.all'), count: guests.length },
                    { key: 'checked_in', label: t('organizerGuestList.filters.checkedIn'), count: checkedInCount },
                    {
                      key: 'not_checked_in',
                      label: t('organizerGuestList.filters.notCheckedIn'),
                      count: guests.length - checkedInCount,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          hasGuests ? (
            <EmptyState icon={Search} title={t('organizerGuestList.emptyFiltered')} compact />
          ) : (
            <EmptyState
              icon={Users}
              title={t('organizerGuestList.empty')}
              subtitle={t('organizerGuestList.emptySubtitle')}
              actionLabel={t('organizerGuestList.add')}
              onAction={openAdd}
            />
          )
        }
      />

      {/* The screen's one white pill. Hidden while the empty state shows its own. */}
      {hasGuests && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <WhitePillCTA
            label={t('organizerGuestList.add')}
            icon={<Plus size={18} color={T.onWhite} strokeWidth={2.5} />}
            onPress={openAdd}
          />
        </View>
      )}

      <FormSheet
        visible={sheetOpen}
        title={editing ? t('organizerGuestList.sheet.editTitle') : t('organizerGuestList.sheet.addTitle')}
        onClose={closeSheet}
        closeLabel={t('common.cancel')}
        busy={saving}
        footer={
          <>
            {!!formError && <Text style={styles.errorText}>{formError}</Text>}
            <WhitePillCTA
              label={
                saving
                  ? t('organizerGuestList.sheet.saving')
                  : editing
                    ? t('organizerGuestList.sheet.save')
                    : t('organizerGuestList.add')
              }
              onPress={handleSave}
              loading={saving}
              disabled={saving}
            />
            {editing && (
              <TouchableOpacity
                onPress={handleRemove}
                disabled={saving}
                style={styles.removeLink}
                accessibilityRole="button"
              >
                <Text style={styles.removeText}>{t('organizerGuestList.sheet.remove')}</Text>
              </TouchableOpacity>
            )}
          </>
        }
      >
        <SheetLabel>{t('organizerGuestList.sheet.name')}</SheetLabel>
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder={t('organizerGuestList.sheet.namePlaceholder')}
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="next"
        />

        <SheetLabel>{t('organizerGuestList.sheet.email')}</SheetLabel>
        <SheetInput
          value={email}
          onChangeText={setEmail}
          placeholder={t('organizerGuestList.sheet.emailPlaceholder')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
        />

        <View style={styles.toggleCard}>
          <ToggleRow
            title={t('organizerGuestList.sheet.plusOne')}
            hint={t('organizerGuestList.sheet.plusOneHint')}
            value={plusOne}
            onValueChange={setPlusOne}
            colors={colors}
          />
          {editing && (
            <>
              <View style={styles.toggleDivider} />
              <ToggleRow
                title={t('organizerGuestList.sheet.checkedIn')}
                hint={t('organizerGuestList.sheet.checkedInHint')}
                value={checkedIn}
                onValueChange={setCheckedIn}
                colors={colors}
              />
            </>
          )}
        </View>
      </FormSheet>
    </View>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onValueChange,
  colors,
}: {
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={toggleStyles.row}>
      <View style={toggleStyles.textWrap}>
        <Text style={[toggleStyles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[toggleStyles.hint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: T.neutralMuted, true: colors.primary }}
        thumbColor={T.white}
        ios_backgroundColor={T.neutralMuted}
        accessibilityLabel={title}
      />
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, marginTop: 2, lineHeight: 18 },
});

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
    },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: spacing.lg,
      paddingHorizontal: 14,
      height: 48,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },
    tabsWrap: {
      // SegmentedTabs pads itself 16pt; pull it back to the list's gutter.
      marginHorizontal: -spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    guestCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginTop: spacing.sm,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.text,
    },
    guestBody: {
      flex: 1,
      minWidth: 0,
    },
    guestName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    guestEmail: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    metaText: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textSecondary,
    },
    checkButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkButtonOn: {
      backgroundColor: T.accentMuted,
    },
    dimmed: {
      opacity: 0.5,
    },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
    },
    toggleCard: {
      marginTop: spacing.xl,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    toggleDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      textAlign: 'center',
    },
    removeLink: {
      alignSelf: 'center',
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    removeText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.error,
      textDecorationLine: 'underline',
    },
  });
