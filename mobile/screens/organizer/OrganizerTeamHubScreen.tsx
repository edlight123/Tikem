import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { collection, getCountFromServer } from 'firebase/firestore';

import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { getOrganizerEvents, OrganizerEvent } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';
import { RADIUS, SPACING } from '../../config/brand';
import { font, radius } from '../../theme/tokens';
import { Skeleton } from '../../components/Skeleton';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Image } from 'expo-image';
import StatusChip from '../../components/StatusChip';
import SectionHeader from '../../components/SectionHeader';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import FormSheet from '../../components/organizer/FormSheet';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type TeamRole = 'admin' | 'manager' | 'staff';

type TeamMember = {
  id: string;
  email: string;
  name?: string | null;
  role: TeamRole;
  status: 'active' | 'invited';
};

// Role → semantic StatusChip status (same mapping as OrganizerOrgTeamScreen).
const roleChipStatus = (role: TeamRole): string =>
  role === 'admin' ? 'live' : role === 'manager' ? 'pending' : 'neutral';

/**
 * Top-level Team hub. Two different things, kept visibly apart:
 *  - TEAM: the organization's roster (people + roles), managed in OrganizerOrgTeam;
 *  - EVENT STAFFING: per-event access (door check-in), managed per event
 *    (data model: events/{id}/members), with a staff count on each row.
 * The "how it works" explainer is an ⓘ sheet rather than an inline block.
 */
export default function OrganizerTeamHubScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<NavigationProp>();
  const { userProfile } = useAuth();
  const { t } = useI18n();
  const { formatDate } = useLocaleFormat();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  // Per-event staff counts. Missing key = not known (count failed or pending),
  // in which case the row simply shows no count.
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const loadStaffCounts = useCallback(async (list: OrganizerEvent[]) => {
    const entries = await Promise.all(
      list.map(async (e) => {
        try {
          const snap = await getCountFromServer(collection(db, 'events', e.id, 'members'));
          return [e.id, snap.data().count] as const;
        } catch {
          return null;
        }
      })
    );
    const next: Record<string, number> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    setStaffCounts(next);
  }, []);

  const load = useCallback(async () => {
    if (!userProfile?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [eventsData, teamData] = await Promise.all([
        getOrganizerEvents(userProfile.id, 100),
        backendJson<{ members: TeamMember[] }>(`/api/organizer/team`).catch(() => ({ members: [] })),
      ]);
      setEvents(eventsData);
      setMembers(teamData?.members || []);
      // Counts paint after the list; a slow count never holds the page.
      loadStaffCounts(eventsData);
    } catch (error) {
      console.error('Error loading team hub:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userProfile?.id, loadStaffCounts]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh on focus so invites/role changes made in OrganizerOrgTeam show up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const roleLabel = (role: TeamRole) => t(`organizerOrgTeam.roles.${role}` as any);

  const staffLine = (eventId: string): string | undefined => {
    const n = staffCounts[eventId];
    if (n === undefined) return undefined;
    if (n === 0) return t('organizerTeamHub.staffNone');
    return t('organizerTeamHub.staffMany').replace('{n}', String(n));
  };

  const ownerInitials = (
    String((userProfile as any)?.full_name || (userProfile as any)?.name || (userProfile as any)?.email || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join('') || '?'
  ).toUpperCase();

  const header = (
    <OrganizerScreenHeader
      title={t('organizerTeamHub.title').toLowerCase()}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
      right={
        <TouchableOpacity
          onPress={() => setShowInfo(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('organizerTeamHub.infoTitle')}
        >
          <Ionicons name="information-circle-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      }
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Identical header to the loaded branch: no in-flow -> overlay flash. */}
        {header}
        <View style={[styles.content, { paddingTop: headerH }]}>
          <Skeleton width={120} height={18} radius={5} style={{ marginBottom: 14 }} />
          {[0, 1].map((i) => (
            <Skeleton key={i} width="100%" height={60} radius={RADIUS.md} style={{ marginBottom: 8 }} />
          ))}
          <Skeleton width={150} height={18} radius={5} style={{ marginTop: 24, marginBottom: 14 }} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={74} radius={RADIUS.lg} style={{ marginBottom: SPACING.md }} />
          ))}
        </View>
      </View>
    );
  }

  const teamEmpty = members.length === 0;

  return (
    <View style={styles.container}>
      {/* Pushed from the dashboard: without onBack this screen was a dead end. */}
      {header}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: headerH + 8, paddingBottom: 32 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {teamEmpty ? (
          // The premium empty state: a crew of monograms, one line that
          // separates team from event staff, and the screen's one white pill.
          <View style={styles.empty}>
            <View style={styles.monoStack}>
              <View style={[styles.monoCircle, styles.monoSide]}>
                <Ionicons name="person-outline" size={18} color={colors.textTertiary} />
              </View>
              <View style={[styles.monoCircle, styles.monoCenter]}>
                <Text style={styles.monoText}>{ownerInitials}</Text>
              </View>
              <View style={[styles.monoCircle, styles.monoSide]}>
                <Ionicons name="add" size={20} color={colors.textTertiary} />
              </View>
            </View>
            <Text style={styles.emptyTitle}>{t('organizerTeamHub.emptyTeamTitle')}</Text>
            <Text style={styles.emptyBody}>{t('organizerTeamHub.emptyTeamBody')}</Text>
            <WhitePillCTA
              label={t('organizerTeamHub.inviteFirst')}
              onPress={() => navigation.navigate('OrganizerOrgTeam')}
              style={styles.emptyCta}
            />
          </View>
        ) : (
          <>
            <SectionHeader
              title={t('organizerTeamHub.teamSection')}
              trailing={
                <TouchableOpacity
                  onPress={() => navigation.navigate('OrganizerOrgTeam')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('organizerTeamHub.manageTeam')}
                >
                  <Text style={styles.textLink}>{t('organizerTeamHub.manageTeam')}</Text>
                </TouchableOpacity>
              }
            />
            {members.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.memberRow}
                onPress={() => navigation.navigate('OrganizerOrgTeam')}
                activeOpacity={0.75}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.name || m.email || '?').trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberBody}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.name || m.email}
                  </Text>
                  {m.status === 'invited' && (
                    <Text style={styles.memberInvited} numberOfLines={1}>
                      {t('organizerTeamHub.invited')}
                    </Text>
                  )}
                </View>
                <StatusChip status={roleChipStatus(m.role)} label={roleLabel(m.role)} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Per-event staffing (scanning / check-in access). */}
        <View style={styles.staffingHeader}>
          <SectionHeader
            title={t('organizerTeamHub.eventStaffingSection')}
            subtitle={t('organizerTeamHub.eventStaffingSubtitle')}
          />
        </View>

        {events.length === 0 ? (
          // Muted line, not a second pill: the team invite above is the one
          // primary action when both lists are empty.
          <Text style={styles.mutedLine}>{t('organizerTeamHub.emptySubtitle')}</Text>
        ) : (
          events.map((event) => {
            const poster = event.banner_image_url || event.cover_image_url || null;
            const count = staffLine(event.id);
            return (
              <TouchableOpacity
                key={event.id}
                style={styles.eventRow}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={event.title}
                onPress={() => navigation.navigate('OrganizerEventStaff', { eventId: event.id })}
              >
                {poster ? (
                  <Image source={{ uri: poster }} style={styles.eventPoster} contentFit="cover" cachePolicy="memory-disk" recyclingKey={event.id} />
                ) : (
                  <View style={[styles.eventPoster, styles.eventPosterFallback]}>
                    <Ionicons name="image-outline" size={16} color={colors.textTertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                  <Text style={styles.eventDate} numberOfLines={1}>{formatDate(event.start_datetime)}</Text>
                </View>
                {count ? (
                  <Text style={[styles.staffCount, staffCounts[event.id] === 0 && styles.staffCountNone]}>{count}</Text>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <FormSheet
        visible={showInfo}
        title={t('organizerTeamHub.infoTitle')}
        onClose={() => setShowInfo(false)}
        closeLabel={t('common.close')}
      >
        <Text style={styles.sheetHeading}>{t('organizerTeamHub.teamSection')}</Text>
        <Text style={styles.sheetBody}>{t('organizerTeamHub.infoTeam')}</Text>
        <Text style={[styles.sheetHeading, { marginTop: 18 }]}>{t('organizerTeamHub.eventStaffingSection')}</Text>
        <Text style={styles.sheetBody}>{t('organizerTeamHub.infoStaff')}</Text>
      </FormSheet>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16 },
    empty: { alignItems: 'center', paddingTop: 24, paddingBottom: 8 },
    monoStack: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
    monoCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    monoSide: { marginHorizontal: -6 },
    monoCenter: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceRaised, zIndex: 1 },
    monoText: { fontFamily: font.mono, fontSize: 15, letterSpacing: 1, color: colors.text },
    emptyTitle: {
      fontFamily: font.serif,
      fontSize: 30,
      lineHeight: 36,
      color: colors.text,
      textAlign: 'center',
    },
    emptyBody: {
      marginTop: 10,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      maxWidth: 320,
    },
    emptyCta: { alignSelf: 'stretch', marginTop: 28 },
    // Event rows: standalone 4:5 poster on the canvas, no card behind the row.
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
      marginBottom: 8,
    },
    eventPoster: { width: 60, aspectRatio: 4 / 5, borderRadius: radius.poster, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
    eventPosterFallback: { alignItems: 'center', justifyContent: 'center' },
    eventTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    eventDate: { marginTop: 3, fontFamily: font.mono, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textSecondary },
    staffCount: { fontFamily: font.mono, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.text },
    staffCountNone: { color: colors.textTertiary },
    textLink: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      textDecorationLine: 'underline',
    },
    // Filled rows on the canvas (fill, not a hairline).
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    memberAvatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    memberAvatarText: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 14,
    },
    memberBody: { flex: 1 },
    memberName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    memberInvited: {
      marginTop: 2,
      fontSize: 11,
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    staffingHeader: { marginTop: 28 },
    mutedLine: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    sheetHeading: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    sheetBody: {
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
  });
