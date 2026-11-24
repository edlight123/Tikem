import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { setSongAutoplay, setTrailerAutoplay, useSongAutoplay, useTrailerAutoplay } from '../lib/songAutoplay';
import { defaultAvatar } from '../lib/defaultAvatar';
import { openTikemInstagram } from '../lib/instagram';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTabBarSpace } from '../hooks/useTabBarSpace';
import {
  Bell,
  Pencil,
  BookOpen,
  Briefcase,
  ChevronRight,
  Camera,
  Compass,
  ExternalLink,
  FileText,
  Heart,
  HelpCircle,
  Instagram,
  LogOut,
  MapPin,
  Inbox,
  Megaphone,
  Phone,
  RotateCcw,
  Shield,
  Trash2,
  Users,
} from 'lucide-react-native';
import Constants from 'expo-constants';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { useAppMode } from '../contexts/AppModeContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, isDemoMode } from '../config/firebase';
import { colors as T, radius, font } from '../theme/tokens';
import { getStaffEventIds } from '../lib/staffAssignments';
import { countAttended, liveTicketEventIds, sortPostersNewestFirst, toDateOrNull } from '../lib/profileStats';
import { getVerificationRequest, type VerificationRequest } from '../lib/verification';
import { updateSocialProfile } from '../lib/api/social';
import { ProfileImageError, uploadProfileImage } from '../lib/profileImages';
import { useImageChooser } from '../hooks/useImageChooser';
import {
  DEFAULT_PRIVACY,
  type AttendanceVisibility,
  type ProfileVisibility,
} from '../types/social';
import VerifiedBadge from '../components/VerifiedBadge';
import StatusChip from '../components/StatusChip';
import EventRail, { RAIL_CARD_SPACING, RAIL_CARD_WIDTH } from '../components/EventRail';
import EmptyState from '../components/EmptyState';
import SectionHeader from '../components/SectionHeader';
import FindFriendsCard from '../components/FindFriendsCard';
import { Skeleton, PosterCardSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import DeleteAccountSheet from '../components/DeleteAccountSheet';
import PhoneLinkSheet from '../components/auth/PhoneLinkSheet';
import InviteSummary from '../components/InviteSummary';
import { usePhoneAuthEnabled } from '../lib/phoneAuth';
import { useOpenAttendeeTab } from '../hooks/useOpenAttendeeTab';
import { useActiveOrg } from '../lib/activeOrg';
import { OrgSwitcherList } from '../components/organizer/OrgSwitcher';
import TeamOrgBrandCard from '../components/organizer/TeamOrgBrandCard';
import { Touchable } from '../components/ui/Touchable';
import { Text as UIText } from '../components/ui/Text';
import { ListGroup, ListRow } from '../components/ui/ListRow';
import { Switch } from '../components/ui/Switch';
import StatusBarBackdrop from '../components/StatusBarBackdrop';
import MessagesButton from '../components/MessagesButton';
import { refreshAttendeeUnread, useAttendeeUnread } from '../lib/attendeeUnread';
import { backendJson } from '../lib/api/backend';

// Tikèm's own accounts, and the studio that builds it. EdLight Labs is the
// technology division of EdLight Initiative, not a separate company. The
// https Instagram URL is a universal link, so it opens the Instagram app when
// it is installed and the browser when it is not.
const EDLIGHT_LABS_URL = 'https://www.edlight.org/labs';

// The poster rail shows the newest few; "view all" opens the Tickets tab,
// which lists every one (TestFlight 2026-10-24: a heavy user's two-column wall
// pushed Privacy and Settings far down the page).
const PROFILE_RAIL_MAX = 6;
const AVATAR = 112;

/**
 * Profile is a VIEW (TestFlight 2026-10-06: "make it premium"). It used to be
 * a long edit form under the avatar; the form now lives on EditProfile.
 *
 * Top to bottom: the identity (big tappable avatar, name in display type,
 * location; edit is the header pencil or a tap on the name), the stat line, the organization card (organizers),
 * find friends, invites, the poster rail, privacy, then settings and sign out.
 * Every section is a `styles.block` (28pt above, nothing below), so the gaps
 * stay even whichever optional sections are present.
 * Visual direction: Stitch "Tikèm, Organizer flows (mobile)" profile concept.
 */
export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const openAttendeeTab = useOpenAttendeeTab();
  const { user, userProfile, signOut, updateUserProfile, refreshUserProfile } = useAuth();
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  // Organizer replies the attendee hasn't opened yet: the Messages row's count,
  // from the same store as the Profile tab's dot (lib/attendeeUnread).
  const unreadMessages = useAttendeeUnread({ enabled: !!user?.uid });
  useFocusEffect(
    useCallback(() => {
      if (user?.uid) refreshAttendeeUnread();
    }, [user?.uid])
  );
  // "Add phone number" (WhatsApp code), behind the phone-auth flag; hidden
  // once the account has a verified phone.
  const phoneAuthOn = usePhoneAuthEnabled();
  const [showPhoneLink, setShowPhoneLink] = useState(false);
  const canAddPhone = phoneAuthOn && !isDemoMode && !!user && !user.phoneNumber;
  const { mode, setMode } = useAppMode();
  const { language, setLanguage, t } = useI18n();
  const showAlert = useAppAlert();
  const chooseImage = useImageChooser();
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();

  const [refreshing, setRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [verificationStatus, setVerificationStatus] = useState<VerificationRequest | null>(null);
  const [accountStats, setAccountStats] = useState({ eventsAttended: 0, following: 0, followers: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);
  // Every event this user holds a ticket to (newest first); the rail shows the head.
  const [myEvents, setMyEvents] = useState<any[]>([]);
  const [staffEventIds, setStaffEventIdsState] = useState<string[]>([]);

  const activeOrg = useActiveOrg();
  // An organizer in their own right (their own org, brand and payouts).
  const isOwnOrganizer =
    userProfile?.role === 'organizer' ||
    userProfile?.role === 'admin' ||
    verificationStatus?.status === 'approved';
  // Organizer mode also opens for admins and managers of someone else's org
  // (docs/specs/org-teams.md). Staff-only members keep the staff tools.
  const canUseOrganizerMode = isOwnOrganizer || activeOrg.hasTeamAccess;
  const canUseStaffTools = staffEventIds.length > 0;

  const displayName = useMemo(() => {
    const name = (userProfile?.full_name || '').trim();
    return name.length ? name : user?.email || '';
  }, [userProfile?.full_name, user?.email]);

  const locationLabel = (userProfile?.default_city || '').trim();

  const loadVerificationStatus = useCallback(async () => {
    if (!user?.uid) {
      setVerificationStatus(null);
      return;
    }
    try {
      setVerificationStatus(await getVerificationRequest(user.uid));
    } catch {
      setVerificationStatus(null);
    }
  }, [user?.uid]);

  const loadStaffIds = useCallback(async () => {
    try {
      setStaffEventIdsState(await getStaffEventIds());
    } catch {
      setStaffEventIdsState([]);
    }
  }, []);

  const loadAccountStats = useCallback(async () => {
    if (!user?.uid) {
      setAccountStats({ eventsAttended: 0, following: 0, followers: 0 });
      setMyEvents([]);
      setStatsLoaded(true);
      return;
    }

    try {
      const followsRef = collection(db, 'organizer_follows');

      const [followingSnap, followersSnap] = await Promise.all([
        getDocs(query(followsRef, where('follower_id', '==', user.uid))),
        getDocs(query(followsRef, where('organizer_id', '==', user.uid))),
      ]);

      // Same rule as the web /profile (../lib/profileStats.ts mirrors the web's
      // lib/profile/dashboard.ts): tickets carry the
      // owner as user_id on some rails and attendee_id on others, so read both;
      // only LIVE tickets count (not refunded / cancelled / transferred away);
      // one event counts once, and only once it has ended.
      const ticketsRef = collection(db, 'tickets');
      const [byUserId, byAttendeeId] = await Promise.all([
        getDocs(query(ticketsRef, where('user_id', '==', user.uid))),
        getDocs(query(ticketsRef, where('attendee_id', '==', user.uid))),
      ]);
      const ticketsById = new Map<string, any>();
      for (const d of [...byUserId.docs, ...byAttendeeId.docs]) ticketsById.set(d.id, d.data());
      const eventIds = liveTicketEventIds(Array.from(ticketsById.values()));

      let attended = 0;
      let posterEvents: any[] = [];
      if (eventIds.length) {
        const eventSnaps = await Promise.all(
          eventIds.map((eventId) => getDocs(query(collection(db, 'events'), where('__name__', '==', eventId))))
        );

        // Normalize dates once so downstream cards get real Date objects (guarded).
        const events = eventSnaps
          .map((s) => {
            if (s.empty) return null;
            const raw = { id: s.docs[0].id, ...s.docs[0].data() } as any;
            // Deleted events drop out, as on the web.
            if (raw.deleted || raw.deleted_at) return null;
            return {
              ...raw,
              start_datetime: toDateOrNull(raw.start_datetime),
              end_datetime: toDateOrNull(raw.end_datetime),
            };
          })
          .filter(Boolean) as any[];

        attended = countAttended(events);
        posterEvents = sortPostersNewestFirst(events);
      }

      setMyEvents(posterEvents);
      setAccountStats({
        eventsAttended: attended,
        following: followingSnap.size,
        followers: followersSnap.size,
      });
    } catch {
      setAccountStats({ eventsAttended: 0, following: 0, followers: 0 });
      setMyEvents([]);
    } finally {
      setStatsLoaded(true);
    }
  }, [user?.uid]);

  const refreshAll = useCallback(async () => {
    if (!user?.uid) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshUserProfile(),
        loadVerificationStatus(),
        loadAccountStats(),
        loadStaffIds(),
        // Also picks up team invites sent to a verified email.
        activeOrg.refresh().catch(() => {}),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [activeOrg.refresh, loadAccountStats, loadStaffIds, loadVerificationStatus, refreshUserProfile, user?.uid]);

  useEffect(() => {
    loadVerificationStatus();
    loadAccountStats();
    loadStaffIds();
  }, [loadAccountStats, loadStaffIds, loadVerificationStatus]);

  const showUploadError = useCallback(
    (e: any, fallbackKey: string) => {
      const key = e instanceof ProfileImageError ? e.key : null;
      showAlert(t('common.error'), key ? t(key) : e?.message || t(fallbackKey));
    },
    [showAlert, t],
  );

  // Photo: tap the avatar (or its camera badge). Applies at once.
  const changePhoto = useCallback(() => {
    if (!user?.uid) return;
    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.avatarDemoDisabled'));
      return;
    }
    chooseImage({
      title: t('profile.photo.title'),
      hasExisting: !!userProfile?.photo_url,
      onPicked: async (asset) => {
        setUploadingPhoto(true);
        try {
          const url = await uploadProfileImage(user.uid, asset, 'avatar');
          await updateUserProfile({ photo_url: url });
        } catch (e) {
          showUploadError(e, 'profile.uploads.photoUploadFailed');
        } finally {
          setUploadingPhoto(false);
        }
      },
      onRemove: async () => {
        try {
          await updateUserProfile({ photo_url: '' });
        } catch (e) {
          showUploadError(e, 'profile.saveErrorBody');
        }
      },
    });
  }, [chooseImage, showAlert, showUploadError, t, updateUserProfile, user?.uid, userProfile?.photo_url]);

  // Organization logo, straight from the card. Applies at once too.
  const changeLogo = useCallback(() => {
    if (!user?.uid) return;
    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.logoDemoDisabled'));
      return;
    }
    chooseImage({
      title: t('profile.organization.logoTitle'),
      removeLabel: t('profile.organization.removeLogo'),
      hasExisting: !!userProfile?.organization_logo,
      onPicked: async (asset) => {
        setUploadingLogo(true);
        try {
          const url = await uploadProfileImage(user.uid, asset, 'logo');
          await updateUserProfile({ organization_logo: url });
        } catch (e) {
          showUploadError(e, 'profile.uploads.logoUploadFailed');
        } finally {
          setUploadingLogo(false);
        }
      },
      onRemove: async () => {
        try {
          await updateUserProfile({ organization_logo: '' });
        } catch (e) {
          showUploadError(e, 'profile.saveErrorBody');
        }
      },
    });
  }, [chooseImage, showAlert, showUploadError, t, updateUserProfile, user?.uid, userProfile?.organization_logo]);

  // EditProfile's organization fields write the person's OWN brand.
  const openEdit = () => navigation.navigate('EditProfile', { organizer: isOwnOrganizer });

  // Profile > "Host events on Tikèm": become an organizer without creating an
  // event first, then land on the organizer Dashboard.
  const [hostingBusy, setHostingBusy] = useState(false);
  const startHosting = () => {
    if (hostingBusy) return;
    showAlert(t('profile.hostEvents.title'), t('profile.hostEvents.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.hostEvents.cta'),
        onPress: async () => {
          setHostingBusy(true);
          try {
            await backendJson('/api/account/become-organizer', { method: 'POST', body: JSON.stringify({}) });
            // The organizer tab set is chosen from the profile, so refresh first.
            await refreshUserProfile();
            setMode('organizer', { landingTab: 'Dashboard' });
          } catch (e) {
            console.warn('become-organizer failed', e);
            showAlert(t('common.error'), t('profile.hostEvents.failed'));
          } finally {
            setHostingBusy(false);
          }
        },
      },
    ]);
  };

  const confirmSignOut = useCallback(() => {
    showAlert(t('profile.signOutTitle'), t('profile.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.signOut'), style: 'destructive', onPress: () => signOut() },
    ]);
  }, [showAlert, signOut, t]);

  const verificationState = useMemo<'approved' | 'pending' | null>(() => {
    if (!verificationStatus?.status) return null;
    if (verificationStatus.status === 'approved') return 'approved';
    if (
      verificationStatus.status === 'pending' ||
      verificationStatus.status === 'pending_review' ||
      verificationStatus.status === 'in_review'
    ) {
      return 'pending';
    }
    return null;
  }, [verificationStatus?.status]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
        <View style={styles.centerEmpty}>
          <Text style={styles.emptyTitle}>{t('auth.loginRequiredTitle')}</Text>
          <Text style={styles.emptyBody}>{t('tickets.loginRequiredBody')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const orgName = (userProfile?.organization_name || '').trim();
  const orgLogo = userProfile?.organization_logo || '';

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            // ONE bottom reservation: tabBarSpace is the whole clearance the
            // overlay tab bar needs; +16 is the visible margin above it.
            paddingBottom: tabBarSpace + 16,
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
      >
        {/* Top-right: edit + notifications. Editing is occasional, so it's an
            icon here rather than a full-width button in the hero. Settings
            live further down this page. */}
        <View style={styles.topRow}>
          <Touchable
            style={styles.headerIconButton}
            onPress={openEdit}
            accessibilityRole="button"
            accessibilityLabel={t('profile.editProfile')}
          >
            <Pencil size={20} color={colors.text} strokeWidth={1.75} />
          </Touchable>
          <Touchable
            style={styles.headerIconButton}
            onPress={() => navigation.navigate('Notifications', { userId: user?.uid || '' })}
            accessibilityRole="button"
            accessibilityLabel={t('profile.notificationsA11y')}
          >
            <Bell size={20} color={colors.text} strokeWidth={1.75} />
          </Touchable>
          {/* Messages up top, not only in the list below (Tikra ef0062d4). */}
          <MessagesButton />
        </View>

        {/* Identity */}
        <View style={styles.hero}>
          <Touchable
            onPress={changePhoto}
            disabled={uploadingPhoto}
            scale={0.98}
            accessibilityRole="button"
            accessibilityLabel={t('profile.photo.a11y')}
          >
            <View style={styles.avatar}>
              {userProfile?.photo_url ? (
                <Image source={{ uri: userProfile.photo_url }} style={styles.avatarImage} contentFit="cover" transition={150} />
              ) : (
                // No photo yet: their drawn portrait (lib/defaultAvatar), the
                // same face friends see. The circle stays the tap target.
                <Image source={defaultAvatar(user?.uid || displayName || '')} style={styles.avatarImage} contentFit="cover" />
              )}
              {uploadingPhoto ? (
                <View style={styles.busyOverlay}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            {/* The camera badge says "this changes" without any instruction text. */}
            <View style={styles.cameraBadge}>
              <Camera size={15} color={T.onWhite} />
            </View>
          </Touchable>

          <TouchableOpacity style={styles.nameRow} onPress={openEdit} activeOpacity={0.7} accessibilityRole="button">
            <Text style={styles.nameText} numberOfLines={2}>
              {displayName}
            </Text>
            {verificationState === 'approved' ? <VerifiedBadge size="small" /> : null}
          </TouchableOpacity>
          {verificationState === 'pending' ? (
            <StatusChip status="pending" label={t('profile.verificationPending')} />
          ) : null}

          {locationLabel ? (
            <View style={styles.locationRow}>
              <MapPin size={14} color={colors.textSecondary} />
              <Text style={styles.locationText} numberOfLines={1}>
                {locationLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Stats: one quiet line under the name ("1 attended · 2 following ·
            7 followers"). Big numerals read heavy (TestFlight 2026-11-14). */}
        <View style={styles.statsRow}>
          {[
            {
              key: 'attended',
              label: t('profile.eventsAttended'),
              value: accountStats.eventsAttended,
              onPress: () => openAttendeeTab('Tickets'),
            },
            {
              key: 'following',
              label: t('profile.following'),
              value: accountStats.following,
              onPress: () => navigation.navigate('Subscriptions'),
            },
            {
              key: 'followers',
              label: t('profile.followers'),
              value: accountStats.followers,
              // Who follows you: public fields only (owner call, 2026-11-18).
              onPress: accountStats.followers > 0 ? () => navigation.navigate('Followers') : undefined,
            },
          ].map((s) => {
            const tappable = statsLoaded && !!s.onPress;
            return (
              <TouchableOpacity
                key={s.key}
                style={styles.statItem}
                onPress={tappable ? s.onPress : undefined}
                disabled={!tappable}
                activeOpacity={tappable ? 0.6 : 1}
                accessibilityRole={tappable ? 'button' : 'text'}
                accessibilityLabel={`${s.value} ${s.label}`}
              >
                {statsLoaded ? (
                  <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    <Text style={styles.statValue}>{s.value}</Text> {s.label.toLowerCase()}
                  </Text>
                ) : (
                  <Skeleton width={64} height={14} radius={4} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Role switching: only when the account has more than one hat. Sits
            right under the stats so someone with an org switches without
            scrolling past posters and settings (TestFlight: "have the bar
            higher"). */}
        {canUseOrganizerMode || canUseStaffTools ? (
          <View style={styles.block}>
            <SectionHeader title={t('profile.viewAs')} />
            <View style={styles.chipRow}>
              {([
                { key: 'attendee', label: t('profile.modeAttendee'), show: true },
                { key: 'organizer', label: t('profile.modeOrganizer'), show: canUseOrganizerMode },
                { key: 'staff', label: t('profile.modeStaff'), show: canUseStaffTools },
              ] as const)
                .filter((m) => m.show)
                .map((m) => {
                  const active = mode === m.key;
                  return (
                    <Touchable
                      key={m.key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setMode(m.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                    </Touchable>
                  );
                })}
            </View>
            {/* Someone who runs more than one org picks which one organizer mode acts for. */}
            {canUseOrganizerMode && activeOrg.options.length > 1 ? (
              <>
                <UIText variant="eyebrow" faint style={styles.subLabel}>
                  {t('orgTeam.switcher.label')}
                </UIText>
                <OrgSwitcherList />
              </>
            ) : null}
          </View>
        ) : null}

        {/* Organization (organizers): the brand shown in place of the
            personal name, with the logo changeable right here. */}
        {/* Acting for someone else's org: that org's card (admins edit it). */}
        {!activeOrg.isOwner && canUseOrganizerMode ? <TeamOrgBrandCard style={styles.block} /> : null}

        {isOwnOrganizer && activeOrg.isOwner ? (
          <View style={styles.block}>
            <SectionHeader title={t('profile.organization.sectionTitle')} />
            {/* The brand as a card, not a settings row (owner, 2026-11-18:
                "see how you can make this more premium"): the logo large with
                a camera badge, the name in the serif, the whole card opens the
                edit. No "Add logo" text button. */}
            <TouchableOpacity style={styles.orgCard} onPress={openEdit} activeOpacity={0.85} accessibilityRole="button">
              <Touchable
                style={styles.orgLogo}
                scale={0.98}
                onPress={changeLogo}
                disabled={uploadingLogo}
                accessibilityRole="button"
                accessibilityLabel={orgLogo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
              >
                {orgLogo ? (
                  <Image source={{ uri: orgLogo }} style={styles.orgLogoImage} contentFit="cover" transition={150} />
                ) : (
                  <Briefcase size={24} color={colors.textSecondary} />
                )}
                {uploadingLogo ? (
                  <View style={styles.busyOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </Touchable>
              <View pointerEvents="none" style={styles.orgCamera}>
                <Camera size={12} color="#000" strokeWidth={2.4} />
              </View>
              <View style={styles.orgMeta}>
                <Text style={[styles.orgName, !orgName && styles.orgNameEmpty]} numberOfLines={1}>
                  {orgName || t('profile.organization.emptyName')}
                </Text>
                <Text style={styles.orgHint} numberOfLines={1}>
                  {t('profile.organization.cardHint')}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ) : null}

        <FindFriendsCard variant="profile" style={styles.block} />

        {/* Friend invite results (config/auth.invites); nothing when off or none sent. */}
        <InviteSummary style={styles.block} />

        {/* Poster rail (POSH §2.1): one row, the newest few, like the Home rails. */}
        <View style={styles.block}>
          {!statsLoaded ? (
            <>
              <SectionHeader title={t('profile.postersTitle')} />
              <View style={styles.railSkeleton}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <PosterCardSkeleton key={i} width={RAIL_CARD_WIDTH} />
                ))}
              </View>
            </>
          ) : myEvents.length > 0 ? (
            <EventRail
              title={t('profile.postersTitle')}
              events={myEvents.slice(0, PROFILE_RAIL_MAX)}
              userCity={userProfile?.default_city}
              onEventPress={(eventId) => navigation.navigate('EventDetail', { eventId })}
              onViewAll={() => openAttendeeTab('Tickets')}
            />
          ) : (
            <>
              <SectionHeader title={t('profile.postersTitle')} />
              <EmptyState
                icon={Compass}
                title={t('profile.postersEmptyTitle')}
                actionLabel={t('profile.postersExplore')}
                onAction={() => openAttendeeTab('Discover')}
                compact
              />
            </>
          )}
        </View>

        <PrivacySection />

        <SoundSection />

        {/* Settings */}
        <View style={styles.block}>
          <SectionHeader title={t('profile.settingsTitle')} />
          <View style={styles.chipRow}>
            {(['en', 'fr', 'ht'] as const).map((lang) => {
              const active = language === lang;
              return (
                <Touchable
                  key={lang}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setLanguage(lang)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{lang.toUpperCase()}</Text>
                </Touchable>
              );
            })}
          </View>
          <ListGroup style={styles.listCard}>
            <ListRow icon={Heart} title={t('tabs.favorites')} onPress={() => navigation.navigate('Favorites')} />
            <ListRow icon={Users} title={t('profile.friends')} onPress={() => navigation.navigate('Connections')} />
            {/* The attendee's conversations with organizers (questions sent from
                an event page and their answers). */}
            <ListRow
              icon={Inbox}
              title={t('attendeeMessages.title')}
              value={unreadMessages > 0 ? String(unreadMessages) : undefined}
              onPress={() => navigation.navigate('Messages')}
            />
            {/* Seen a flyer for an event that is not on Tikèm? Share it (lib/community). */}
            <ListRow icon={Megaphone} title={t('community.share.entry')} onPress={() => navigation.navigate('ShareEvent')} />
            {/* Publish-first: anyone can create an event; KYC is deferred to payout. */}
            {isOwnOrganizer || activeOrg.hasTeamAccess ? (
              <ListRow icon={Briefcase} title={t('profile.createEvent')} onPress={() => navigation.navigate('CreateEvent')} />
            ) : (
              // Not an organizer yet: one tap opens organizer mode, no event
              // needed first (owner, 2026-11-17). Same server step as the web's
              // "create your organization"; ID checks stay at payout.
              <ListRow
                icon={Briefcase}
                title={t('profile.hostEvents.row')}
                value={hostingBusy ? '…' : undefined}
                onPress={startHosting}
              />
            )}
            <ListRow
              icon={Bell}
              title={t('notificationSettings.title')}
              onPress={() => navigation.navigate('NotificationSettings', { organizer: canUseOrganizerMode })}
            />
            {canAddPhone ? (
              <ListRow icon={Phone} title={t('auth.phone.link.row')} onPress={() => setShowPhoneLink(true)} />
            ) : null}
          </ListGroup>
        </View>

        <View style={styles.block}>
          <SectionHeader title={t('profile.help')} />
          <ListGroup style={styles.listCard}>
            <ListRow
              icon={HelpCircle}
              title={t('profile.helpCenter')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'support', title: t('profile.helpCenter') })}
            />
            {/* Step-by-step guides: the web /resources library, in-app. */}
            <ListRow
              icon={BookOpen}
              title={t('profile.guides')}
              onPress={() =>
                navigation.navigate('InAppWebView', { url: 'https://www.tikem.co/resources', title: t('profile.guides') })
              }
            />
            <ListRow
              icon={FileText}
              title={t('profile.terms')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'terms', title: t('profile.terms') })}
            />
            <ListRow
              icon={Shield}
              title={t('profile.privacy')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'privacy', title: t('profile.privacy') })}
            />
            <ListRow
              icon={RotateCcw}
              title={t('profile.refundPolicy')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'refunds', title: t('profile.refundPolicy') })}
            />
            <ListRow icon={Camera} title={t('profile.photoCredits')} onPress={() => navigation.navigate('PhotoCredits')} />
            <ListRow
              icon={Instagram}
              title={t('profile.instagram')}
              onPress={openTikemInstagram}
              trailing={
                <View style={styles.rowLeft}>
                  <Text style={styles.aboutHandle}>@tikem.co</Text>
                  <ExternalLink size={15} color={colors.textTertiary} />
                </View>
              }
            />
          </ListGroup>
        </View>

        <ListGroup style={styles.signOutCard}>
          <ListRow icon={LogOut} title={t('profile.signOut')} onPress={confirmSignOut} destructive chevron={false} />
        </ListGroup>

        {/* Account deletion (App Store 5.1.1(v)): findable, never louder than Sign out. */}
        {!isDemoMode ? (
          <TouchableOpacity
            style={styles.deleteAccountRow}
            onPress={() => setShowDeleteAccount(true)}
            accessibilityRole="button"
          >
            <Trash2 size={15} color={colors.textTertiary} />
            <Text style={styles.deleteAccountText}>{t('profile.deleteAccount.row')}</Text>
          </TouchableOpacity>
        ) : null}
        {/* Colophon: who builds Tikèm, and which build this is. */}
        <TouchableOpacity
          style={styles.colophon}
          onPress={() => navigation.navigate('InAppWebView', { url: EDLIGHT_LABS_URL, title: 'EdLight Labs' })}
          accessibilityRole="link"
        >
          <Text style={styles.colophonText}>{t('profile.builtBy')}</Text>
          {Constants.expoConfig?.version ? (
            <Text style={styles.colophonMeta}>
              {t('profile.version')} {Constants.expoConfig.version}
            </Text>
          ) : null}
        </TouchableOpacity>
        <DeleteAccountSheet visible={showDeleteAccount} onClose={() => setShowDeleteAccount(false)} />
        {canAddPhone || showPhoneLink ? (
          <PhoneLinkSheet visible={showPhoneLink} onClose={() => setShowPhoneLink(false)} />
        ) : null}
      </ScrollView>
      {/* No top bar here, so keep content from sliding under the clock. */}
      <StatusBarBackdrop />
    </SafeAreaView>
  );
}

/**
 * Privacy, edited in place: each choice saves as it is made (optimistic, and
 * put back with an alert if the save fails). These are not part of "Edit
 * profile" because they are decisions, not profile content.
 */
/** Device-level sound settings: for now, whether event songs start on their own. */
function SoundSection() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const on = useSongAutoplay();
  const trailers = useTrailerAutoplay();
  return (
    <View style={styles.block}>
      <SectionHeader title={t('profile.sound.title')} />
      <ListGroup style={styles.listCard} inset={16}>
        <ListRow
          title={t('profile.sound.autoplay')}
          trailing={
            <Switch value={on} onValueChange={setSongAutoplay} accessibilityLabel={t('profile.sound.autoplay')} />
          }
        />
        <ListRow
          title={t('profile.sound.trailers')}
          trailing={
            <Switch value={trailers} onValueChange={setTrailerAutoplay} accessibilityLabel={t('profile.sound.trailers')} />
          }
        />
      </ListGroup>
    </View>
  );
}

function PrivacySection() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const { userProfile, refreshUserProfile } = useAuth();

  const fromProfile = useCallback(
    () => ({
      profile_visibility: (userProfile?.privacy?.profile_visibility || DEFAULT_PRIVACY.profile_visibility) as ProfileVisibility,
      attendance_visibility: (userProfile?.privacy?.attendance_visibility ||
        DEFAULT_PRIVACY.attendance_visibility) as AttendanceVisibility,
      discoverable_by_phone: userProfile?.privacy?.discoverable_by_phone ?? DEFAULT_PRIVACY.discoverable_by_phone,
      discoverable: userProfile?.discoverable !== false,
    }),
    [userProfile?.privacy, userProfile?.discoverable],
  );
  const [state, setState] = useState(fromProfile);
  // Re-seed whenever the screen regains focus (e.g. after the web changed it).
  useFocusEffect(
    useCallback(() => {
      setState(fromProfile());
    }, [fromProfile]),
  );

  const commit = async (patch: Partial<ReturnType<typeof fromProfile>>) => {
    const prev = state;
    const next = { ...state, ...patch };
    setState(next);
    try {
      await updateSocialProfile({
        // The whole privacy object every time: the server replaces it.
        privacy: {
          profile_visibility: next.profile_visibility,
          attendance_visibility: next.attendance_visibility,
          discoverable_by_phone: next.discoverable_by_phone,
        },
        discoverable: next.discoverable,
      });
      refreshUserProfile().catch(() => {});
    } catch {
      setState(prev);
      showAlert(t('profile.saveErrorTitle'), t('profile.saveErrorBody'));
    }
  };

  const segment = <V extends string>(value: V, options: { value: V; label: string }[], onPick: (v: V) => void) => (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Touchable
            key={o.value}
            style={[styles.chip, styles.chipFlex, active && styles.chipActive]}
            onPress={() => !active && onPick(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Touchable>
        );
      })}
    </View>
  );

  const toggle = (label: string, hint: string, on: boolean, onPress: () => void) => (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch value={on} onValueChange={onPress} accessibilityLabel={label} />
    </View>
  );

  return (
    <View style={styles.block}>
      <SectionHeader title={t('profile.social.privacyTitle')} />
      <View style={styles.privacyCard}>
        <Text style={styles.fieldLabel}>{t('profile.social.profileVisibility')}</Text>
        {segment(
          state.profile_visibility,
          [
            { value: 'private' as ProfileVisibility, label: t('profile.social.profilePrivate') },
            { value: 'public' as ProfileVisibility, label: t('profile.social.profilePublic') },
          ],
          (v) => commit({ profile_visibility: v }),
        )}

        <Text style={styles.fieldLabel}>{t('profile.social.attendanceTitle')}</Text>
        {segment(
          state.attendance_visibility,
          [
            { value: 'nobody' as AttendanceVisibility, label: t('profile.social.attNobody') },
            { value: 'friends' as AttendanceVisibility, label: t('profile.social.attFriends') },
            { value: 'everyone' as AttendanceVisibility, label: t('profile.social.attEveryone') },
          ],
          (v) => commit({ attendance_visibility: v }),
        )}

        {toggle(
          t('profile.social.discoverable'),
          '',
          state.discoverable_by_phone,
          () => commit({ discoverable_by_phone: !state.discoverable_by_phone }),
        )}
        {toggle(
          t('profile.social.suggestable'),
          '',
          state.discoverable,
          () => commit({ discoverable: !state.discoverable }),
        )}
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 16 },
    topRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
    headerIconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

    hero: { alignItems: 'center', marginTop: 4 },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarInitial: { fontSize: 44, fontWeight: '700', color: colors.text },
    busyOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // White disc with a black glyph, ringed in the page colour so it reads as
    // sitting ON the avatar edge.
    cameraBadge: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: T.white,
      borderWidth: 3,
      borderColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nameRow: {
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 8,
    },
    nameText: {
      flexShrink: 1,
      fontFamily: font.serif,
      fontSize: 36,
      lineHeight: 40,
      letterSpacing: -0.4,
      color: colors.text,
      textAlign: 'center',
    },
    locationRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
    locationText: { fontSize: 13, color: colors.textSecondary },

    statsRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'nowrap', columnGap: 16, marginTop: 10, paddingHorizontal: 8 },
    statItem: { paddingVertical: 4, flexShrink: 1, minWidth: 0 },
    statValue: { fontWeight: '700', color: colors.text },
    statLabel: { fontSize: 13, color: colors.textSecondary },

    block: { marginTop: 28 },

    orgCard: {
      backgroundColor: T.surface,
      borderRadius: radius.lg,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    orgCamera: {
      position: 'absolute',
      left: 16 + 72 - 18,
      top: 16 + 72 - 18,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
      borderWidth: 2,
      borderColor: T.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orgLogo: {
      width: 72,
      height: 72,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orgLogoImage: { width: '100%', height: '100%' },
    orgMeta: { flex: 1, minWidth: 0 },
    orgName: { fontFamily: font.serif, fontSize: 26, lineHeight: 30, color: colors.text },
    orgNameEmpty: { color: colors.textSecondary, fontFamily: undefined, fontSize: 15, fontWeight: '600' },
    orgHint: { marginTop: 4, fontSize: 13, lineHeight: 17, color: colors.textSecondary },
    orgAction: { fontSize: 13, fontWeight: '700', color: colors.text },

    // Same width and gap as EventRail's cards; overflow is clipped by the page.
    railSkeleton: { flexDirection: 'row', gap: RAIL_CARD_SPACING, overflow: 'hidden', marginRight: -16 },

    privacyCard: { backgroundColor: T.surface, borderRadius: radius.lg, padding: 16, paddingTop: 4 },
    fieldLabel: { marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: '600', color: colors.text },
    caption: { marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
    subLabel: { marginTop: 24, marginBottom: 8 },
    chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
    },
    chipFlex: { flex: 1, paddingHorizontal: 6 },
    // Chosen = the one pure white (POSH ladder), not a teal fill.
    chipActive: { backgroundColor: T.white },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextActive: { color: T.onWhite },
    toggleRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
    toggleLabel: { fontSize: 15, fontWeight: '500', color: colors.text },
    toggleHint: { marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.textSecondary },
    listCard: { marginTop: 12 },
    signOutCard: { marginTop: 24 },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowText: { fontSize: 15, fontWeight: '500', color: colors.text },
    aboutHandle: { fontSize: 13, fontWeight: '500', color: colors.textTertiary },

    deleteAccountRow: {
      marginTop: 8,
      marginBottom: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    deleteAccountText: { fontSize: 13, fontWeight: '500', color: colors.error, opacity: 0.85 },
    colophon: { alignItems: 'center', paddingTop: 12, paddingBottom: 24, gap: 4 },
    colophonText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, color: colors.textSecondary },
    colophonMeta: { fontSize: 12, color: colors.textTertiary },
    centerEmpty: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8, textAlign: 'center' },
    emptyBody: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  });
