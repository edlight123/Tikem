import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../hooks/useTabBarSpace';
import { Bell, BookOpen, Briefcase, ChevronRight, Compass, FileText, Heart, HelpCircle, LogOut, MapPin, RotateCcw, Settings, Shield, Trash2, Users } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { useAuth } from '../contexts/AuthContext';
import { useAppMode } from '../contexts/AppModeContext';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, isDemoMode, storage } from '../config/firebase';
import { RADIUS } from '../config/brand';
import { radius } from '../theme/tokens';
import { getStaffEventIds } from '../lib/staffAssignments';
import { getVerificationRequest, type VerificationRequest } from '../lib/verification';
import { useNavigation } from '@react-navigation/native';
import { CITIES_BY_COUNTRY, COUNTRIES } from '../types/filters';
import SelectField from '../components/organizer/SelectField';
import { updateSocialProfile } from '../lib/api/social';
import {
  DEFAULT_PRIVACY,
  normalizeSocialHandle,
  type AttendanceVisibility,
  type ProfileVisibility,
} from '../types/social';
import VerifiedBadge from '../components/VerifiedBadge';
import StatusChip from '../components/StatusChip';
import PosterEventCard from '../components/PosterEventCard';
import EmptyState from '../components/EmptyState';
import { Skeleton, PosterCardSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import DeleteAccountSheet from '../components/DeleteAccountSheet';
import { findMetro } from '../data/metros';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Two-column poster wall inside the 16px-padded scroll content (12px gutter).
const PROFILE_POSTER_WIDTH = (SCREEN_WIDTH - 32 - 12) / 2;

export default function ProfileScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const { user, userProfile, signOut, updateUserProfile, refreshUserProfile } = useAuth();
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const { mode, setMode } = useAppMode();
  const { language, setLanguage, t } = useI18n();
  const { setUserCountry, setActiveCity } = useFilters();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();

  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [editedName, setEditedName] = useState(userProfile?.full_name || '');
  const [editedCity, setEditedCity] = useState(userProfile?.default_city || '');
  const [editedCountry, setEditedCountry] = useState(userProfile?.default_country || 'HT');

  // Organizer brand identity (edited alongside the rest of the profile form).
  const [editedOrgName, setEditedOrgName] = useState(userProfile?.organization_name || '');
  const [orgLogoUrl, setOrgLogoUrl] = useState(userProfile?.organization_logo || '');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Social profile + privacy (edited together with the rest of the profile form)
  const [editedBio, setEditedBio] = useState(userProfile?.bio || '');
  const [editedInstagram, setEditedInstagram] = useState(userProfile?.social_links?.instagram || '');
  const [editedTiktok, setEditedTiktok] = useState(userProfile?.social_links?.tiktok || '');
  const [editedTwitter, setEditedTwitter] = useState(userProfile?.social_links?.twitter || '');
  const [editedFacebook, setEditedFacebook] = useState(userProfile?.social_links?.facebook || '');
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>(
    userProfile?.privacy?.profile_visibility || DEFAULT_PRIVACY.profile_visibility
  );
  const [attendanceVisibility, setAttendanceVisibility] = useState<AttendanceVisibility>(
    userProfile?.privacy?.attendance_visibility || DEFAULT_PRIVACY.attendance_visibility
  );
  const [discoverableByPhone, setDiscoverableByPhone] = useState<boolean>(
    userProfile?.privacy?.discoverable_by_phone ?? DEFAULT_PRIVACY.discoverable_by_phone
  );

  const [phonePrefix, setPhonePrefix] = useState<'+509' | '+1'>('+509');
  const [phoneDigits, setPhoneDigits] = useState('');

  const [verificationStatus, setVerificationStatus] = useState<VerificationRequest | null>(null);
  const [accountStats, setAccountStats] = useState({ eventsAttended: 0, following: 0, followers: 0 });
  const [statsLoaded, setStatsLoaded] = useState(false);
  // The poster wall — every event this user holds a ticket to (newest first).
  // Gives the profile a POSH poster-forward identity instead of a settings list.
  const [myEvents, setMyEvents] = useState<any[]>([]);
  const [staffEventIds, setStaffEventIdsState] = useState<string[]>([]);

  const parsePhone = useCallback((raw: string) => {
    const normalized = String(raw || '').trim();
    if (normalized.startsWith('+1')) {
      setPhonePrefix('+1');
      setPhoneDigits(normalized.replace(/^\+1\s*/, '').replace(/\D/g, ''));
      return;
    }
    if (normalized.startsWith('+509')) {
      setPhonePrefix('+509');
      setPhoneDigits(normalized.replace(/^\+509\s*/, '').replace(/\D/g, ''));
      return;
    }

    // Default to Haiti prefix
    setPhonePrefix('+509');
    setPhoneDigits(normalized.replace(/\D/g, ''));
  }, []);

  const canUseOrganizerMode =
    userProfile?.role === 'organizer' ||
    userProfile?.role === 'admin' ||
    verificationStatus?.status === 'approved';
  const canUseStaffTools = staffEventIds.length > 0;

  const displayName = useMemo(() => {
    const name = (userProfile?.full_name || '').trim();
    return name.length ? name : user?.email || '';
  }, [userProfile?.full_name, user?.email]);

  const locationLabel = useMemo(() => {
    const city = (userProfile?.default_city || '').trim();
    return city.length ? city : t('profile.notSet');
  }, [userProfile?.default_city, t]);

  const loadVerificationStatus = useCallback(async () => {
    if (!user?.uid) {
      setVerificationStatus(null);
      return;
    }

    try {
      const req = await getVerificationRequest(user.uid);
      setVerificationStatus(req);
    } catch {
      setVerificationStatus(null);
    }
  }, [user?.uid]);

  const loadStaffIds = useCallback(async () => {
    try {
      const ids = await getStaffEventIds();
      setStaffEventIdsState(ids);
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
      const eventIds = Array.from(new Set(ticketDocs.map((t) => String(t.event_id || '')).filter(Boolean)));

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

  useEffect(() => {
    if (!isEditing) {
      setEditedName(userProfile?.full_name || '');
      setEditedCity(userProfile?.default_city || '');
      setEditedCountry(userProfile?.default_country || 'HT');
      setEditedOrgName(userProfile?.organization_name || '');
      setOrgLogoUrl(userProfile?.organization_logo || '');
      parsePhone(userProfile?.phone_number || '');
      setEditedBio(userProfile?.bio || '');
      setEditedInstagram(userProfile?.social_links?.instagram || '');
      setEditedTiktok(userProfile?.social_links?.tiktok || '');
      setEditedTwitter(userProfile?.social_links?.twitter || '');
      setEditedFacebook(userProfile?.social_links?.facebook || '');
      setProfileVisibility(userProfile?.privacy?.profile_visibility || DEFAULT_PRIVACY.profile_visibility);
      setAttendanceVisibility(userProfile?.privacy?.attendance_visibility || DEFAULT_PRIVACY.attendance_visibility);
      setDiscoverableByPhone(userProfile?.privacy?.discoverable_by_phone ?? DEFAULT_PRIVACY.discoverable_by_phone);
    }
  }, [isEditing, parsePhone, userProfile?.default_city, userProfile?.default_country, userProfile?.full_name, userProfile?.organization_name, userProfile?.organization_logo, userProfile?.phone_number, userProfile?.bio, userProfile?.social_links?.instagram, userProfile?.social_links?.tiktok, userProfile?.social_links?.twitter, userProfile?.social_links?.facebook, userProfile?.privacy?.profile_visibility, userProfile?.privacy?.attendance_visibility, userProfile?.privacy?.discoverable_by_phone]);

  // Cities available for the selected country — drives the City dropdown.
  const citiesForCountry = useMemo(() => {
    return CITIES_BY_COUNTRY[editedCountry] || CITIES_BY_COUNTRY['HT'] || [];
  }, [editedCountry]);

  const pickAndUploadAvatar = useCallback(async () => {
    if (!user?.uid) return;

    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.avatarDemoDisabled'));
      return;
    }

    try {
      setUploadingPhoto(true);

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert(t('common.error'), t('profile.uploads.photoPermissionRequired'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const uri = result.assets[0].uri;
      const res = await fetch(uri);
      const blob = await res.blob();

      const path = `profile-images/${user.uid}/avatar_${Date.now()}.jpg`;
      const fileRef = storageRef(storage, path);

      await uploadBytes(fileRef, blob);
      const url = await getDownloadURL(fileRef);
      await updateUserProfile({ photo_url: url });

      await loadAccountStats();
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('profile.uploads.photoUploadFailed'));
    } finally {
      setUploadingPhoto(false);
    }
  }, [loadAccountStats, t, updateUserProfile, user?.uid]);

  const pickAndUploadOrgLogo = useCallback(async () => {
    if (!user?.uid) return;

    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.logoDemoDisabled'));
      return;
    }

    try {
      setUploadingLogo(true);

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert(t('common.error'), t('profile.uploads.photoPermissionRequired'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const uri = result.assets[0].uri;
      const res = await fetch(uri);
      const blob = await res.blob();

      const path = `org-logos/${user.uid}/logo_${Date.now()}.jpg`;
      const fileRef = storageRef(storage, path);

      await uploadBytes(fileRef, blob);
      const url = await getDownloadURL(fileRef);
      // Held in local state; persisted (with the name) when the form is saved.
      setOrgLogoUrl(url);
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('profile.uploads.logoUploadFailed'));
    } finally {
      setUploadingLogo(false);
    }
  }, [t, user?.uid]);

  const saveProfile = useCallback(async () => {
    if (!user?.uid) return;

    const name = editedName.trim();
    if (!name) {
      showAlert(t('profile.missingNameTitle'), t('profile.missingNameBody'));
      return;
    }

    try {
      setSaving(true);

      const digits = phoneDigits.replace(/\D/g, '');
      const combinedPhone = digits.length ? `${phonePrefix}${digits}` : '';

      await updateUserProfile({
        full_name: name,
        phone_number: combinedPhone,
        default_city: editedCity,
        default_country: editedCountry,
        // Organizer brand identity — writes users/{uid} and mirrors into the
        // public projection, so it shows wherever the organizer is displayed.
        ...(canUseOrganizerMode
          ? { organization_name: editedOrgName.trim(), organization_logo: orgLogoUrl || '' }
          : {}),
      });

      // Persist social handles + bio + privacy via the shared backend endpoint.
      await updateSocialProfile({
        bio: editedBio.trim(),
        socialLinks: {
          instagram: normalizeSocialHandle(editedInstagram),
          tiktok: normalizeSocialHandle(editedTiktok),
          twitter: normalizeSocialHandle(editedTwitter),
          facebook: normalizeSocialHandle(editedFacebook),
        },
        privacy: {
          profile_visibility: profileVisibility,
          attendance_visibility: attendanceVisibility,
          discoverable_by_phone: discoverableByPhone,
        },
      });
      await refreshUserProfile();

      // Move the ONE active browse location with the profile. The typed city is
      // adopted only when it maps to a metro we know; a free-text typo would
      // otherwise scope browsing to a place that can never have events. The
      // country-wide scope is the honest fallback, and the location picker is
      // one tap away.
      setUserCountry(editedCountry);
      setActiveCity(findMetro(editedCity, editedCountry) ? editedCity : '');
      
      setIsEditing(false);
      showAlert(t('profile.saveSuccessTitle'), t('profile.saveSuccessBody'));
    } catch {
      showAlert(t('profile.saveErrorTitle'), t('profile.saveErrorBody'));
    } finally {
      setSaving(false);
    }
  }, [setActiveCity, canUseOrganizerMode, editedBio, editedCity, editedCountry, editedFacebook, editedInstagram, editedName, editedOrgName, editedTiktok, editedTwitter, orgLogoUrl, attendanceVisibility, discoverableByPhone, profileVisibility, phoneDigits, phonePrefix, refreshUserProfile, setUserCountry, t, updateUserProfile, user?.uid]);

  const confirmSignOut = useCallback(() => {
    showAlert(t('profile.signOutTitle'), t('profile.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.signOut'), style: 'destructive', onPress: () => signOut() },
    ]);
  }, [signOut, t]);

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

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            // No separate top bar anymore — the notification + settings icons
            // live on the identity row itself (top-right), so the avatar/name
            // sits right below the notch with no dead gap (beta feedback).
            paddingTop: insets.top + 12,
            // ONE bottom reservation, not three. `tabBarSpace` is the whole
            // clearance the overlay tab bar needs; the +16 is the visible margin
            // between the last row and the bar. There used to be a trailing 24pt
            // spacer View stacked on top of this (and, before the bar became an
            // overlay, the bar's own in-flow height on top of THAT), which is why
            // the list ran on into ~178pt of black past "Sign Out".
            paddingBottom: tabBarSpace + 16,
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <TouchableOpacity
              style={styles.avatar}
              onPress={isEditing ? pickAndUploadAvatar : undefined}
              disabled={!isEditing || uploadingPhoto}
              accessibilityLabel={t('profile.changePhoto')}
            >
              {userProfile?.photo_url ? (
                <Image source={{ uri: userProfile.photo_url }} style={styles.avatarImage} />
              ) : (
                /* The initial, not a generic person glyph on a teal blob.
                   That placeholder carried no identity — the name is right
                   beside it — and read as a stray logo. The element stays
                   because it is the tap target for uploading a photo while
                   editing. */
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>
                    {(displayName || '?').trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.profileMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.nameText} numberOfLines={1}>
                  {displayName}
                </Text>
                {verificationState === 'approved' ? (
                  <VerifiedBadge size="small" />
                ) : verificationState === 'pending' ? (
                  <StatusChip status="pending" label={t('profile.verificationPending')} />
                ) : null}
              </View>

              <View style={styles.locationRow}>
                <MapPin size={14} color={colors.textSecondary} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {locationLabel}
                </Text>
              </View>

              {isEditing ? <Text style={styles.editHint}>{t('profile.editProfileHint')}</Text> : null}
            </View>

            {/* Actions ride on the identity row (top-right), aligned with the
                avatar/name — no separate absolute top bar, so there's no gap. */}
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={() => navigation.navigate('Notifications', { userId: user?.uid || '' })}
                accessibilityLabel={t('profile.notificationsA11y')}
                hitSlop={8}
              >
                <Bell size={22} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={() => setIsEditing((v) => !v)}
                accessibilityLabel={t('profile.edit')}
                hitSlop={8}
              >
                <Settings size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.statsRow}>
            {[
              {
                key: 'attended',
                label: t('profile.eventsAttended'),
                value: accountStats.eventsAttended,
                // Events you have tickets to.
                onPress: () => navigation.navigate('Main', { screen: 'Tickets' }),
              },
              {
                key: 'following',
                label: t('profile.following'),
                value: accountStats.following,
                // Your own subscriptions — the organizers/channels you follow.
                onPress: () => navigation.navigate('Subscriptions'),
              },
              {
                key: 'followers',
                label: t('profile.followers'),
                value: accountStats.followers,
                // People who follow you: shown as a COUNT only — we don't expose
                // who they are (privacy). So this stat is not tappable.
                onPress: undefined,
              },
            ].map((s, i) => {
              const tappable = statsLoaded && !!s.onPress;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.statItem, i > 0 && styles.statItemDivided]}
                  onPress={tappable ? s.onPress : undefined}
                  disabled={!tappable}
                  activeOpacity={tappable ? 0.6 : 1}
                  accessibilityRole={tappable ? 'button' : 'text'}
                  accessibilityLabel={s.label}
                >
                  {statsLoaded ? (
                    <Text style={styles.statValue}>{s.value}</Text>
                  ) : (
                    <Skeleton width={32} height={20} radius={6} />
                  )}
                  <Text style={styles.statLabel} numberOfLines={1}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isEditing ? (
            <View style={styles.editForm}>
              <Text style={styles.fieldLabel}>{t('profile.fullName')}</Text>
              <TextInput
                style={styles.input}
                value={editedName}
                onChangeText={setEditedName}
                placeholder={t('profile.placeholders.name')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
              />

              <Text style={styles.fieldLabel}>{t('profile.phone')}</Text>
              <View style={styles.phoneRow}>
                <View style={styles.prefixRow}>
                  {(['+509', '+1'] as const).map((p) => {
                    const active = phonePrefix === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[styles.prefixPill, active && styles.prefixPillActive]}
                        onPress={() => setPhonePrefix(p)}
                      >
                        <Text style={[styles.prefixPillText, active && styles.prefixPillTextActive]}>{p}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  value={phoneDigits}
                  onChangeText={(value) => setPhoneDigits(value.replace(/\D/g, ''))}
                  placeholder={t('profile.placeholders.phone')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Country + city as dependent dropdowns, both wired to the shared
                  COUNTRIES / CITIES_BY_COUNTRY taxonomy used across the app so a
                  profile location always matches a filterable place. */}
              <SelectField
                label={t('profile.defaultCountry') || 'Country'}
                value={COUNTRIES.find(c => c.code === editedCountry)?.name || ''}
                options={COUNTRIES.map(c => c.name)}
                placeholder={t('profile.placeholders.country') || 'Select country'}
                sheetTitle={t('profile.defaultCountry') || 'Country'}
                onSelect={(name) => {
                  const picked = COUNTRIES.find(c => c.name === name);
                  if (!picked || picked.code === editedCountry) return;
                  setEditedCountry(picked.code);
                  setEditedCity(''); // City list depends on country — reset it.
                }}
              />

              <SelectField
                label={t('profile.defaultCity')}
                value={editedCity}
                options={citiesForCountry}
                placeholder={t('profile.placeholders.city')}
                sheetTitle={t('profile.defaultCity')}
                onSelect={setEditedCity}
              />

              {/* Organization brand — organizers only. Shown wherever the
                  organizer appears, in place of the personal name. */}
              {canUseOrganizerMode ? (
                <>
                  <View style={styles.formDivider} />
                  <Text style={styles.formSubsectionTitle}>{t('profile.organization.sectionTitle')}</Text>
                  <Text style={styles.helperText}>{t('profile.organization.hint')}</Text>

                  <Text style={styles.fieldLabel}>{t('profile.organization.nameLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editedOrgName}
                    onChangeText={setEditedOrgName}
                    placeholder={t('profile.organization.namePlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                  />

                  <Text style={styles.fieldLabel}>{t('profile.organization.logoLabel')}</Text>
                  <TouchableOpacity
                    style={styles.orgLogoRow}
                    onPress={pickAndUploadOrgLogo}
                    disabled={uploadingLogo}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <View style={styles.orgLogoPreview}>
                      {orgLogoUrl ? (
                        <Image source={{ uri: orgLogoUrl }} style={styles.orgLogoImage} />
                      ) : (
                        <Briefcase size={22} color={colors.primary} />
                      )}
                    </View>
                    <Text style={styles.orgLogoAction}>
                      {uploadingLogo
                        ? t('profile.saving')
                        : orgLogoUrl
                        ? t('profile.organization.changeLogo')
                        : t('profile.organization.addLogo')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {/* Social handles + bio */}
              <View style={styles.formDivider} />
              <Text style={styles.formSubsectionTitle}>{t('profile.social.sectionTitle')}</Text>

              <Text style={styles.fieldLabel}>{t('profile.social.bio')}</Text>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={editedBio}
                onChangeText={(value) => setEditedBio(value.slice(0, 280))}
                placeholder={t('profile.social.bioPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                multiline
                maxLength={280}
              />
              <Text style={styles.charCount}>{editedBio.length}/280</Text>

              <Text style={styles.helperText}>{t('profile.social.handlesHint')}</Text>

              <Text style={styles.fieldLabel}>Instagram</Text>
              <TextInput
                style={styles.input}
                value={editedInstagram}
                onChangeText={setEditedInstagram}
                placeholder="@username"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>TikTok</Text>
              <TextInput
                style={styles.input}
                value={editedTiktok}
                onChangeText={setEditedTiktok}
                placeholder="@username"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>X / Twitter</Text>
              <TextInput
                style={styles.input}
                value={editedTwitter}
                onChangeText={setEditedTwitter}
                placeholder="@username"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.fieldLabel}>Facebook</Text>
              <TextInput
                style={styles.input}
                value={editedFacebook}
                onChangeText={setEditedFacebook}
                placeholder="username"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* Privacy */}
              <View style={styles.formDivider} />
              <Text style={styles.formSubsectionTitle}>{t('profile.social.privacyTitle')}</Text>

              <Text style={styles.fieldLabel}>{t('profile.social.profileVisibility')}</Text>
              <View style={styles.segmentRow}>
                {([
                  { value: 'private' as ProfileVisibility, label: t('profile.social.profilePrivate') },
                  { value: 'public' as ProfileVisibility, label: t('profile.social.profilePublic') },
                ]).map((opt) => {
                  const active = profileVisibility === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      onPress={() => setProfileVisibility(opt.value)}
                    >
                      <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.helperText}>{t('profile.social.profileHint')}</Text>

              <Text style={styles.fieldLabel}>{t('profile.social.attendanceTitle')}</Text>
              <View style={styles.segmentRow}>
                {([
                  { value: 'nobody' as AttendanceVisibility, label: t('profile.social.attNobody') },
                  { value: 'friends' as AttendanceVisibility, label: t('profile.social.attFriends') },
                  { value: 'everyone' as AttendanceVisibility, label: t('profile.social.attEveryone') },
                ]).map((opt) => {
                  const active = attendanceVisibility === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      onPress={() => setAttendanceVisibility(opt.value)}
                    >
                      <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setDiscoverableByPhone((v) => !v)}
                activeOpacity={0.7}
              >
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>{t('profile.social.discoverable')}</Text>
                  <Text style={styles.toggleHint}>{t('profile.social.discoverableHint')}</Text>
                </View>
                <View style={[styles.switchTrack, discoverableByPhone && styles.switchTrackOn]}>
                  <View style={[styles.switchThumb, discoverableByPhone && styles.switchThumbOn]} />
                </View>
              </TouchableOpacity>

              <View style={styles.editActionsRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, styles.actionButtonHalf]}
                  onPress={() => setIsEditing(false)}
                  disabled={saving || uploadingPhoto}
                >
                  <Text style={styles.secondaryButtonText}>{t('profile.cancel')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryButton, styles.actionButtonHalf]}
                  onPress={saveProfile}
                  disabled={saving || uploadingPhoto}
                >
                  <Text style={styles.primaryButtonText}>{saving ? t('profile.saving') : t('profile.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

        {/* Poster wall — POSH poster-forward identity (§2.1). Hidden while editing. */}
        {!isEditing ? (
          <View style={styles.postersSection}>
            <Text style={styles.postersTitle}>{t('profile.postersTitle')}</Text>
            {!statsLoaded ? (
              // Poster-shaped placeholders so the wall doesn't flash the empty
              // state (or a blank gap) before tickets finish loading.
              <View style={styles.postersGrid}>
                {Array.from({ length: 4 }).map((_, i) => (
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
                onAction={() => navigation.navigate('Main', { screen: 'Discover' })}
                compact
              />
            )}
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.actions')}</Text>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('Favorites')}>
            <View style={styles.rowLeft}>
              <Heart size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('tabs.favorites')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('Connections')}>
            <View style={styles.rowLeft}>
              <Users size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.friends')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Publish-first: anyone can create an event (the center Create FAB
              already lets unverified users through). KYC is deferred to payout,
              so this row always routes to CreateEvent instead of gating
              unverified users into verification here. */}
          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('CreateEvent')}>
            <View style={styles.rowLeft}>
              <Briefcase size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.createEvent')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

        </View>

        {/* Role switching lives in its own segmented section (mirrors the
            Preferences language pills) instead of bare, chevron-less rows mixed
            into Actions — one clear "which hat am I wearing" control. Only shown
            when the account actually has more than the attendee role. */}
        {(canUseOrganizerMode || canUseStaffTools) ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('profile.viewAs')}</Text>
            <View style={styles.languageRow}>
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
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setMode(m.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
            {/* Discoverability: the double-tap gesture on the Profile tab is
                invisible otherwise. Plain caption — no one-time state to manage. */}
            {canUseOrganizerMode ? (
              <Text style={styles.modeSwitchTip}>{t('profile.modeSwitchTip')}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.help')}</Text>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('ContentPage', { slug: 'support', title: t('profile.helpCenter') })}>
            <View style={styles.rowLeft}>
              <HelpCircle size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.helpCenter')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Step-by-step guides (attendee + organizer) — the web /resources
              library rendered in-app, already localized en/fr/ht. */}
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() =>
              navigation.navigate('InAppWebView', {
                url: 'https://www.tikem.co/resources',
                title: t('profile.guides'),
              })
            }
          >
            <View style={styles.rowLeft}>
              <BookOpen size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.guides')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.legal')}</Text>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('ContentPage', { slug: 'terms', title: t('profile.terms') })}>
            <View style={styles.rowLeft}>
              <FileText size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.terms')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('ContentPage', { slug: 'privacy', title: t('profile.privacy') })}>
            <View style={styles.rowLeft}>
              <Shield size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.privacy')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.rowButton} onPress={() => navigation.navigate('ContentPage', { slug: 'refunds', title: t('profile.refundPolicy') })}>
            <View style={styles.rowLeft}>
              <RotateCcw size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('profile.refundPolicy')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('profile.preferences')}</Text>

          <View style={styles.languageRow}>
            {(['en', 'fr', 'ht'] as const).map((lang) => {
              const active = language === lang;
              return (
                <TouchableOpacity
                  key={lang}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setLanguage(lang)}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{lang.toUpperCase()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => navigation.navigate('NotificationSettings', { organizer: canUseOrganizerMode })}
          >
            <View style={styles.rowLeft}>
              <Bell size={18} color={colors.primary} />
              <Text style={styles.rowText}>{t('notificationSettings.title')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.rowButton} onPress={confirmSignOut}>
            <View style={styles.rowLeft}>
              <LogOut size={18} color={colors.error} />
              <Text style={[styles.rowText, { color: colors.error }]}>{t('profile.signOut')}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Account deletion (App Store 5.1.1(v)). A quiet row off the card —
            findable, but never louder than Sign out. */}
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
        <DeleteAccountSheet visible={showDeleteAccount} onClose={() => setShowDeleteAccount(false)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerIconButton: {
    padding: 8,
    borderRadius: radius.xl,
    backgroundColor: 'transparent',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // Ride the top of the identity row (aligned with the name), not centered
    // against the avatar — keeps the bell/gear at the top-right corner.
    alignSelf: 'flex-start',
    marginLeft: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 0,
    paddingHorizontal: 16,
  },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  prefixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prefixPill: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  prefixPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  prefixPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  prefixPillTextActive: {
    color: colors.onPrimary,
  },
  phoneInput: {
    flex: 1,
  },
  // Elevation, not borders (POSH §1): the card separates from the canvas by
  // being a brightness step lighter, never by drawing a 1px box.
  // POSH: the profile identity sits directly on the black canvas — no raised
  // card, no nested boxes. Just a compact avatar + name + a slim stat line.
  card: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.borderLight,
    marginRight: 12,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  avatarInitial: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },
  profileMeta: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    flex: 1,
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
  },
  locationRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  editHint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 18,
    alignItems: 'stretch',
  },
  // Each column is evenly weighted and centered so the three read as one
  // balanced, intentional row (beta feedback: felt non-uniform).
  statItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  statItemDivided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderLight,
  },
  statValue: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 19,
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    textAlign: 'center',
  },
  editForm: {
    marginTop: 16,
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  // Grouped-disclosure field: a raised surface row, no 1px box (POSH §1 / item 7).
  input: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  orgLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  orgLogoPreview: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  orgLogoImage: {
    width: '100%',
    height: '100%',
  },
  orgLogoAction: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  formDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginTop: 18,
    marginBottom: 4,
  },
  formSubsectionTitle: {
    marginTop: 6,
    marginBottom: 2,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  segmentBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentBtnTextActive: {
    color: colors.onPrimary,
  },
  toggleRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  toggleHint: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: colors.primary,
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  editActionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  actionButtonHalf: {
    flex: 1,
  },
  primaryButton: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  primaryButtonText: {
    color: '#000000',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.borderLight,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  sectionCard: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  postersSection: {
    marginTop: 24,
    marginBottom: 4,
  },
  postersTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
    marginBottom: 14,
  },
  postersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  modeSwitchTip: {
    paddingHorizontal: 16,
    marginTop: -4,
    paddingBottom: 12,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Selected = a SOLID teal fill with no border of its own (the border colour
  // matches the fill purely so the chip doesn't resize between states). The
  // teal-tinted, teal-outlined treatment it replaces read as "maybe selected".
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  pillText: {
    fontWeight: '800',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.onPrimary,
  },
  rowButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  deleteAccountRow: {
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteAccountText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.error,
    opacity: 0.85,
  },
  centerEmpty: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
