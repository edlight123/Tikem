import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
  Camera,
  ChevronRight,
  Compass,
  ExternalLink,
  FileText,
  Heart,
  HelpCircle,
  Instagram,
  LogOut,
  MapPin,
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
import { colors as T, radius } from '../theme/tokens';
import { getStaffEventIds } from '../lib/staffAssignments';
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
import PosterEventCard from '../components/PosterEventCard';
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

// Tikèm's own accounts, and the studio that builds it. EdLight Labs is the
// technology division of EdLight Initiative, not a separate company. The
// https Instagram URL is a universal link, so it opens the Instagram app when
// it is installed and the browser when it is not.
const INSTAGRAM_URL = 'https://www.instagram.com/tikem.co/';
const EDLIGHT_LABS_URL = 'https://www.edlight.org/labs';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Two-column poster wall inside the 16px-padded scroll content (12px gutter).
const PROFILE_POSTER_WIDTH = (SCREEN_WIDTH - 32 - 12) / 2;
const AVATAR = 112;

/**
 * Profile is a VIEW (TestFlight 2026-10-06: "make it premium"). It used to be
 * a long edit form under the avatar; the form now lives on EditProfile.
 *
 * Top to bottom: the identity (big tappable avatar, name in display type,
 * location; edit is the header pencil or a tap on the name), the stat line, the organization card (organizers),
 * find friends, invites, the poster wall, privacy, then settings and sign out.
 * Visual direction: Stitch "Tikèm, Organizer flows (mobile)" profile concept.
 */
export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const openAttendeeTab = useOpenAttendeeTab();
  const { user, userProfile, signOut, updateUserProfile, refreshUserProfile } = useAuth();
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
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
  // The poster wall: every event this user holds a ticket to (newest first).
  const [myEvents, setMyEvents] = useState<any[]>([]);
  const [staffEventIds, setStaffEventIdsState] = useState<string[]>([]);

  const canUseOrganizerMode =
    userProfile?.role === 'organizer' ||
    userProfile?.role === 'admin' ||
    verificationStatus?.status === 'approved';
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

      const ticketsSnap = await getDocs(query(collection(db, 'tickets'), where('user_id', '==', user.uid)));
      const ticketDocs = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      const eventIds = Array.from(new Set(ticketDocs.map((tk) => String(tk.event_id || '')).filter(Boolean)));

      let attended = 0;
      let posterEvents: any[] = [];
      if (eventIds.length) {
        const now = new Date();
        const eventSnaps = await Promise.all(
          eventIds.map((eventId) => getDocs(query(collection(db, 'events'), where('__name__', '==', eventId))))
        );

        // Normalize dates once so downstream cards get real Date objects (guarded).
        const toDate = (v: any): Date | null =>
          v?.toDate ? v.toDate() : v ? new Date(v) : null;

        const events = eventSnaps
          .map((s) => {
            if (s.empty) return null;
            const raw = { id: s.docs[0].id, ...s.docs[0].data() } as any;
            return {
              ...raw,
              start_datetime: toDate(raw.start_datetime),
              end_datetime: toDate(raw.end_datetime),
            };
          })
          .filter(Boolean) as any[];

        attended = events.filter((e) => {
          const cutoff = e.end_datetime || e.start_datetime;
          return cutoff && cutoff < now;
        }).length;

        // Poster wall: newest first, undated events sink to the bottom.
        posterEvents = [...events].sort((a, b) => {
          const at = a.start_datetime ? a.start_datetime.getTime() : 0;
          const bt = b.start_datetime ? b.start_datetime.getTime() : 0;
          return bt - at;
        });
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
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [loadAccountStats, loadStaffIds, loadVerificationStatus, refreshUserProfile, user?.uid]);

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

  const openEdit = () => navigation.navigate('EditProfile', { organizer: canUseOrganizerMode });

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
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={openEdit}
            accessibilityRole="button"
            accessibilityLabel={t('profile.editProfile')}
            hitSlop={8}
          >
            <Pencil size={21} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => navigation.navigate('Notifications', { userId: user?.uid || '' })}
            accessibilityLabel={t('profile.notificationsA11y')}
            hitSlop={8}
          >
            <Bell size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Identity */}
        <View style={styles.hero}>
          <TouchableOpacity
            onPress={changePhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('profile.photo.a11y')}
          >
            <View style={styles.avatar}>
              {userProfile?.photo_url ? (
                <Image source={{ uri: userProfile.photo_url }} style={styles.avatarImage} contentFit="cover" transition={150} />
              ) : (
                // The initial, not a generic person glyph: the name is right
                // below it, and the circle stays the tap target for a photo.
                <Text style={styles.avatarInitial}>{(displayName || '?').trim().charAt(0).toUpperCase()}</Text>
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
          </TouchableOpacity>

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

        {/* Stats: big numerals, tiny captions, no rules between them. */}
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
              // A COUNT only: who follows you is not exposed (privacy).
              onPress: undefined,
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
                  <Text style={styles.statValue}>{s.value}</Text>
                ) : (
                  <Skeleton width={32} height={24} radius={6} />
                )}
                <Text style={styles.statLabel} numberOfLines={1}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Organization (organizers): the brand shown in place of the
            personal name, with the logo changeable right here. */}
        {canUseOrganizerMode ? (
          <View style={styles.block}>
            <SectionHeader title={t('profile.organization.sectionTitle')} />
            <View style={styles.orgCard}>
              <TouchableOpacity
                style={styles.orgLogo}
                onPress={changeLogo}
                disabled={uploadingLogo}
                accessibilityRole="button"
                accessibilityLabel={orgLogo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
              >
                {orgLogo ? (
                  <Image source={{ uri: orgLogo }} style={styles.orgLogoImage} contentFit="cover" transition={150} />
                ) : (
                  <Briefcase size={22} color={colors.textSecondary} />
                )}
                {uploadingLogo ? (
                  <View style={styles.busyOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity style={styles.orgMeta} onPress={openEdit} accessibilityRole="button">
                <Text style={[styles.orgName, !orgName && styles.orgNameEmpty]} numberOfLines={1}>
                  {orgName || t('profile.organization.emptyName')}
                </Text>
                <Text style={styles.orgHint} numberOfLines={2}>
                  {t('profile.organization.hint')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={changeLogo} disabled={uploadingLogo} hitSlop={10} accessibilityRole="button">
                <Text style={styles.orgAction}>
                  {orgLogo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <FindFriendsCard variant="profile" style={styles.block} />

        {/* Friend invite results (config/auth.invites); nothing when off or none sent. */}
        <InviteSummary />

        {/* Poster wall (POSH §2.1). */}
        <View style={styles.block}>
          <SectionHeader title={t('profile.postersTitle')} />
          {!statsLoaded ? (
            <View style={styles.postersGrid}>
              {Array.from({ length: 2 }).map((_, i) => (
                <PosterCardSkeleton key={i} width={PROFILE_POSTER_WIDTH} />
              ))}
            </View>
          ) : myEvents.length > 0 ? (
            <View style={styles.postersGrid}>
              {myEvents.map((event) => (
                <PosterEventCard
                  key={event.id}
                  event={event}
                  width={PROFILE_POSTER_WIDTH}
                  userCity={userProfile?.default_city}
                  onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Compass}
              title={t('profile.postersEmptyTitle')}
              subtitle={t('profile.postersEmptyBody')}
              actionLabel={t('profile.postersExplore')}
              onAction={() => openAttendeeTab('Discover')}
              compact
            />
          )}
        </View>

        <PrivacySection />

        {/* Role switching: only when the account has more than one hat. */}
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
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setMode(m.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
            {canUseOrganizerMode ? <Text style={styles.caption}>{t('profile.modeSwitchTip')}</Text> : null}
          </View>
        ) : null}

        {/* Settings */}
        <View style={styles.block}>
          <SectionHeader title={t('profile.settingsTitle')} />
          <View style={styles.chipRow}>
            {(['en', 'fr', 'ht'] as const).map((lang) => {
              const active = language === lang;
              return (
                <TouchableOpacity
                  key={lang}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setLanguage(lang)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{lang.toUpperCase()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.listCard}>
            <Row first icon={Heart} label={t('tabs.favorites')} onPress={() => navigation.navigate('Favorites')} />
            <Row icon={Users} label={t('profile.friends')} onPress={() => navigation.navigate('Connections')} />
            {/* Publish-first: anyone can create an event; KYC is deferred to payout. */}
            <Row icon={Briefcase} label={t('profile.createEvent')} onPress={() => navigation.navigate('CreateEvent')} />
            <Row
              icon={Bell}
              label={t('notificationSettings.title')}
              onPress={() => navigation.navigate('NotificationSettings', { organizer: canUseOrganizerMode })}
            />
            {canAddPhone ? (
              <Row icon={Phone} label={t('auth.phone.link.row')} onPress={() => setShowPhoneLink(true)} />
            ) : null}
          </View>
        </View>

        <View style={styles.block}>
          <SectionHeader title={t('profile.help')} />
          <View style={styles.listCard}>
            <Row
              first
              icon={HelpCircle}
              label={t('profile.helpCenter')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'support', title: t('profile.helpCenter') })}
            />
            {/* Step-by-step guides: the web /resources library, in-app. */}
            <Row
              icon={BookOpen}
              label={t('profile.guides')}
              onPress={() =>
                navigation.navigate('InAppWebView', { url: 'https://www.tikem.co/resources', title: t('profile.guides') })
              }
            />
            <Row
              icon={FileText}
              label={t('profile.terms')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'terms', title: t('profile.terms') })}
            />
            <Row
              icon={Shield}
              label={t('profile.privacy')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'privacy', title: t('profile.privacy') })}
            />
            <Row
              icon={RotateCcw}
              label={t('profile.refundPolicy')}
              onPress={() => navigation.navigate('ContentPage', { slug: 'refunds', title: t('profile.refundPolicy') })}
            />
            <Row
              icon={Instagram}
              label={t('profile.instagram')}
              role="link"
              onPress={() => Linking.openURL(INSTAGRAM_URL).catch(() => {})}
              trailing={
                <View style={styles.rowLeft}>
                  <Text style={styles.aboutHandle}>@tikem.co</Text>
                  <ExternalLink size={15} color={colors.textTertiary} />
                </View>
              }
            />
          </View>
        </View>

        <View style={[styles.listCard, styles.signOutCard]}>
          <Row first icon={LogOut} label={t('profile.signOut')} onPress={confirmSignOut} tone="danger" trailing={null} />
        </View>

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
    </SafeAreaView>
  );
}

type ListRowProps = {
  icon: any;
  label: string;
  onPress: () => void;
  first?: boolean;
  /** Replaces the chevron; null for none. */
  trailing?: React.ReactNode;
  tone?: 'danger';
  role?: 'link' | 'button';
};

/** One row of a settings list: icon, label, chevron. */
function Row({ icon: Icon, label, onPress, first, trailing, tone, role }: ListRowProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.rowButton, !first && styles.rowDivided]}
      onPress={onPress}
      accessibilityRole={role || 'button'}
    >
      <View style={styles.rowLeft}>
        <Icon size={18} color={tone === 'danger' ? colors.error : colors.textSecondary} />
        <Text style={[styles.rowText, tone === 'danger' && { color: colors.error }]}>{label}</Text>
      </View>
      {trailing === undefined ? <ChevronRight size={18} color={colors.textTertiary} /> : trailing}
    </TouchableOpacity>
  );
}

/**
 * Privacy, edited in place: each choice saves as it is made (optimistic, and
 * put back with an alert if the save fails). These are not part of "Edit
 * profile" because they are decisions, not profile content.
 */
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
          <TouchableOpacity
            key={o.value}
            style={[styles.chip, styles.chipFlex, active && styles.chipActive]}
            onPress={() => !active && onPick(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const toggle = (label: string, hint: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity
      style={styles.toggleRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
        <View style={[styles.switchThumb, on && styles.switchThumbOn]} />
      </View>
    </TouchableOpacity>
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
        <Text style={styles.caption}>{t('profile.social.profileHint')}</Text>

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
          t('profile.social.discoverableHint'),
          state.discoverable_by_phone,
          () => commit({ discoverable_by_phone: !state.discoverable_by_phone }),
        )}
        {toggle(
          t('profile.social.suggestable'),
          t('profile.social.suggestableHint'),
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
    headerIconButton: { padding: 8 },

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
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 36,
      lineHeight: 40,
      letterSpacing: -0.4,
      color: colors.text,
      textAlign: 'center',
    },
    locationRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
    locationText: { fontSize: 14, color: colors.textSecondary },

    statsRow: { flexDirection: 'row', marginTop: 20, marginBottom: 8 },
    statItem: { flex: 1, alignItems: 'center', paddingVertical: 6 },
    statValue: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
    statLabel: {
      marginTop: 4,
      fontSize: 10.5,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textTertiary,
    },

    block: { marginTop: 28 },

    orgCard: {
      backgroundColor: T.surface,
      borderRadius: radius.lg,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    orgLogo: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orgLogoImage: { width: '100%', height: '100%' },
    orgMeta: { flex: 1, minWidth: 0 },
    orgName: { fontSize: 15, fontWeight: '700', color: colors.text },
    orgNameEmpty: { color: colors.textSecondary, fontWeight: '600' },
    orgHint: { marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.textTertiary },
    orgAction: { fontSize: 13, fontWeight: '700', color: colors.text },

    postersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

    privacyCard: { backgroundColor: T.surface, borderRadius: radius.lg, padding: 16, paddingTop: 4 },
    fieldLabel: { marginTop: 12, marginBottom: 8, fontSize: 13, fontWeight: '600', color: colors.text },
    caption: { marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
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
    toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    toggleHint: { marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.textSecondary },
    switchTrack: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: T.surfaceRaised,
      padding: 3,
      justifyContent: 'center',
    },
    // A real toggle: teal here MEANS on.
    switchTrackOn: { backgroundColor: colors.primary },
    switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: T.white, alignSelf: 'flex-start' },
    switchThumbOn: { alignSelf: 'flex-end' },

    listCard: { marginTop: 10, backgroundColor: T.surface, borderRadius: radius.lg, overflow: 'hidden' },
    signOutCard: { marginTop: 28 },
    rowButton: {
      paddingHorizontal: 16,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    // A divider INSIDE a dense list, not a box outline.
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
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
    colophonMeta: { fontSize: 11, color: colors.textTertiary },
    centerEmpty: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 8, textAlign: 'center' },
    emptyBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  });
