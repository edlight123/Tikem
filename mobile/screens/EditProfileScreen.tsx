import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Briefcase, ChevronLeft } from 'lucide-react-native';

import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { useTheme } from '../contexts/ThemeContext';
import { isDemoMode } from '../config/firebase';
import { colors as T, radius } from '../theme/tokens';
import { CITIES_BY_COUNTRY, COUNTRIES } from '../types/filters';
import { findMetro } from '../data/metros';
import { updateSocialProfile } from '../lib/api/social';
import { normalizeSocialHandle } from '../types/social';
import { composeStoredPhone, PRIMARY_DIALS, readTypedPhone, splitStoredPhone } from '../lib/profilePhone';
import { ProfileImageError, uploadProfileImage } from '../lib/profileImages';
import { useImageChooser } from '../hooks/useImageChooser';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import SectionHeader from '../components/SectionHeader';
import SelectField from '../components/organizer/SelectField';
import { useAppAlert } from '../components/AppAlert';

/**
 * Edit profile: the form that used to sit inline under the avatar on Profile.
 * Profile is now a view; everything editable lives here, with one sticky Save.
 *
 * - Photo changes apply at once (they are their own action, like on Profile).
 * - Everything else, the organization logo included, is held until Save, so
 *   Back can offer to discard.
 * - The phone is stored as E.164; see lib/profilePhone for how a stored value
 *   is split back into the chip and the number.
 */
export default function EditProfileScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const chooseImage = useImageChooser();
  const { setUserCountry, setActiveCity } = useFilters();
  const { user, userProfile, updateUserProfile, refreshUserProfile } = useAuth();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();

  const canEditOrganization =
    route?.params?.organizer === true || userProfile?.role === 'organizer' || userProfile?.role === 'admin';

  // Seeded once from the profile; the form owns its state from here on.
  const initial = useMemo(() => {
    const country = userProfile?.default_country || 'HT';
    const phone = splitStoredPhone(userProfile?.phone_number, country);
    return {
      name: userProfile?.full_name || '',
      dial: phone.dial,
      national: phone.national,
      country,
      city: userProfile?.default_city || '',
      orgName: userProfile?.organization_name || '',
      orgLogo: userProfile?.organization_logo || '',
      bio: userProfile?.bio || '',
      instagram: userProfile?.social_links?.instagram || '',
      tiktok: userProfile?.social_links?.tiktok || '',
      twitter: userProfile?.social_links?.twitter || '',
      facebook: userProfile?.social_links?.facebook || '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [name, setName] = useState(initial.name);
  const [dial, setDial] = useState(initial.dial);
  const [national, setNational] = useState(initial.national);
  const [country, setCountry] = useState(initial.country);
  const [city, setCity] = useState(initial.city);
  const [orgName, setOrgName] = useState(initial.orgName);
  const [orgLogo, setOrgLogo] = useState(initial.orgLogo);
  const [bio, setBio] = useState(initial.bio);
  const [instagram, setInstagram] = useState(initial.instagram);
  const [tiktok, setTiktok] = useState(initial.tiktok);
  const [twitter, setTwitter] = useState(initial.twitter);
  const [facebook, setFacebook] = useState(initial.facebook);

  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const dirty =
    name !== initial.name ||
    composeStoredPhone(dial, national) !== composeStoredPhone(initial.dial, initial.national) ||
    country !== initial.country ||
    city !== initial.city ||
    orgName !== initial.orgName ||
    orgLogo !== initial.orgLogo ||
    bio !== initial.bio ||
    instagram !== initial.instagram ||
    tiktok !== initial.tiktok ||
    twitter !== initial.twitter ||
    facebook !== initial.facebook;

  // Back with unsaved edits asks first. A successful save sets `leaving` so
  // its own goBack is not intercepted.
  const leaving = useRef(false);
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (leaving.current || !dirty) return;
      e.preventDefault();
      showAlert(t('profile.discardTitle'), t('profile.discardBody'), [
        { text: t('profile.keepEditing'), style: 'cancel' },
        {
          text: t('profile.discard'),
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsub;
  }, [dirty, navigation, showAlert, t]);

  const citiesForCountry = useMemo(() => CITIES_BY_COUNTRY[country] || CITIES_BY_COUNTRY['HT'] || [], [country]);

  // The chips: Haiti, US/Canada, France, plus whatever code the stored number
  // actually carries, so a +44 number is shown as +44 rather than coerced.
  const dialChips = useMemo(() => {
    const list: string[] = [...PRIMARY_DIALS];
    if (!list.includes(dial)) list.push(dial);
    return list;
  }, [dial]);

  const uploadError = (e: any, fallbackKey: string) => {
    const key = e instanceof ProfileImageError ? e.key : null;
    showAlert(t('common.error'), key ? t(key) : e?.message || t(fallbackKey));
  };

  const changePhoto = () => {
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
          uploadError(e, 'profile.uploads.photoUploadFailed');
        } finally {
          setUploadingPhoto(false);
        }
      },
      onRemove: async () => {
        try {
          await updateUserProfile({ photo_url: '' });
        } catch (e) {
          uploadError(e, 'profile.saveErrorBody');
        }
      },
    });
  };

  const changeLogo = () => {
    if (!user?.uid) return;
    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.logoDemoDisabled'));
      return;
    }
    chooseImage({
      title: t('profile.organization.logoTitle'),
      removeLabel: t('profile.organization.removeLogo'),
      hasExisting: !!orgLogo,
      onPicked: async (asset) => {
        setUploadingLogo(true);
        try {
          // Held until Save, with the organization name.
          setOrgLogo(await uploadProfileImage(user.uid, asset, 'logo'));
        } catch (e) {
          uploadError(e, 'profile.uploads.logoUploadFailed');
        } finally {
          setUploadingLogo(false);
        }
      },
      onRemove: () => setOrgLogo(''),
    });
  };

  const save = useCallback(async () => {
    if (!user?.uid) return;
    const trimmed = name.trim();
    if (!trimmed) {
      showAlert(t('profile.missingNameTitle'), t('profile.missingNameBody'));
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile({
        full_name: trimmed,
        phone_number: composeStoredPhone(dial, national),
        default_city: city,
        default_country: country,
        ...(canEditOrganization ? { organization_name: orgName.trim(), organization_logo: orgLogo || '' } : {}),
      });
      await updateSocialProfile({
        bio: bio.trim(),
        socialLinks: {
          instagram: normalizeSocialHandle(instagram),
          tiktok: normalizeSocialHandle(tiktok),
          twitter: normalizeSocialHandle(twitter),
          facebook: normalizeSocialHandle(facebook),
        },
      });
      await refreshUserProfile();
      // Move the ONE active browse location with the profile, but only to a
      // city we know (a typo would scope browsing to a place with no events).
      setUserCountry(country);
      setActiveCity(findMetro(city, country) ? city : '');
      leaving.current = true;
      navigation.goBack();
    } catch {
      showAlert(t('profile.saveErrorTitle'), t('profile.saveErrorBody'));
    } finally {
      setSaving(false);
    }
  }, [bio, canEditOrganization, city, country, dial, facebook, instagram, name, national, navigation, orgLogo, orgName, refreshUserProfile, setActiveCity, setUserCountry, showAlert, t, tiktok, twitter, updateUserProfile, user?.uid]);

  const field = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      selectionColor={colors.primary}
      {...props}
      style={[styles.input, props.style]}
    />
  );

  const busy = saving || uploadingPhoto || uploadingLogo;
  const displayName = name.trim() || user?.email || '?';

  return (
    <View style={styles.container}>
      <OverlayHeader onHeight={onHeaderHeight} style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={16} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('profile.editTitle')}</Text>
        <View style={{ width: 26 }} />
      </OverlayHeader>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: headerH + 12 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo */}
          <TouchableOpacity
            style={styles.photoWrap}
            onPress={changePhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('profile.photo.a11y')}
          >
            <View style={styles.avatar}>
              {userProfile?.photo_url ? (
                <Image source={{ uri: userProfile.photo_url }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
              )}
              {uploadingPhoto ? (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <Text style={styles.photoAction}>{t('profile.changePhoto')}</Text>
          </TouchableOpacity>

          <SectionHeader title={t('profile.editSectionYou')} />
          <View style={styles.group}>
            <Text style={styles.label}>{t('profile.fullName')}</Text>
            {field({ value: name, onChangeText: setName, placeholder: t('profile.placeholders.name'), autoComplete: 'name' })}

            <Text style={styles.label}>{t('profile.phone')}</Text>
            <View style={styles.dialRow}>
              {dialChips.map((d) => {
                const active = d === dial;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dialChip, active && styles.dialChipActive]}
                    onPress={() => setDial(d)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.dialChipText, active && styles.dialChipTextActive]}>+{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {field({
              value: national,
              onChangeText: (text: string) => {
                const next = readTypedPhone(text, dial);
                setDial(next.dial);
                setNational(next.national);
              },
              placeholder: t('profile.placeholders.phone'),
              keyboardType: 'phone-pad',
              autoComplete: 'tel',
              textContentType: 'telephoneNumber',
            })}

            <SelectField
              label={t('profile.defaultCountry')}
              value={COUNTRIES.find((c) => c.code === country)?.name || ''}
              options={COUNTRIES.map((c) => c.name)}
              placeholder={t('profile.placeholders.country')}
              sheetTitle={t('profile.defaultCountry')}
              onSelect={(picked) => {
                const c = COUNTRIES.find((x) => x.name === picked);
                if (!c || c.code === country) return;
                setCountry(c.code);
                setCity(''); // The city list depends on the country.
              }}
            />
            <SelectField
              label={t('profile.defaultCity')}
              value={city}
              options={citiesForCountry}
              placeholder={t('profile.placeholders.city')}
              sheetTitle={t('profile.defaultCity')}
              onSelect={setCity}
            />
          </View>

          {canEditOrganization ? (
            <>
              <SectionHeader title={t('profile.organization.sectionTitle')} subtitle={t('profile.organization.hint')} subtitleLines={2} />
              <View style={styles.group}>
                <View style={styles.logoRow}>
                  <TouchableOpacity
                    style={styles.logoPreview}
                    onPress={changeLogo}
                    disabled={uploadingLogo}
                    accessibilityRole="button"
                    accessibilityLabel={orgLogo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
                  >
                    {orgLogo ? (
                      <Image source={{ uri: orgLogo }} style={styles.logoImage} contentFit="cover" />
                    ) : (
                      <Briefcase size={22} color={colors.textSecondary} />
                    )}
                    {uploadingLogo ? (
                      <View style={styles.avatarBusy}>
                        <ActivityIndicator color="#FFFFFF" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={styles.logoLabel}>{t('profile.organization.logoTitle')}</Text>
                    <View style={styles.logoActions}>
                      <TouchableOpacity onPress={changeLogo} disabled={uploadingLogo} hitSlop={8}>
                        <Text style={styles.textAction}>
                          {orgLogo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
                        </Text>
                      </TouchableOpacity>
                      {orgLogo ? (
                        <TouchableOpacity onPress={() => setOrgLogo('')} disabled={uploadingLogo} hitSlop={8}>
                          <Text style={[styles.textAction, styles.textActionMuted]}>{t('profile.organization.removeLogo')}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>

                <Text style={styles.label}>{t('profile.organization.nameLabel')}</Text>
                {field({ value: orgName, onChangeText: setOrgName, placeholder: t('profile.organization.namePlaceholder') })}
              </View>
            </>
          ) : null}

          <SectionHeader title={t('profile.social.sectionTitle')} subtitle={t('profile.social.handlesHint')} subtitleLines={2} />
          <View style={styles.group}>
            <Text style={styles.label}>{t('profile.social.bio')}</Text>
            {field({
              value: bio,
              onChangeText: (v: string) => setBio(v.slice(0, 280)),
              placeholder: t('profile.social.bioPlaceholder'),
              multiline: true,
              maxLength: 280,
              style: styles.bioInput,
            })}
            <Text style={styles.charCount}>{bio.length}/280</Text>

            {(
              [
                ['Instagram', instagram, setInstagram, '@username'],
                ['TikTok', tiktok, setTiktok, '@username'],
                ['X / Twitter', twitter, setTwitter, '@username'],
                ['Facebook', facebook, setFacebook, 'username'],
              ] as const
            ).map(([label, value, set, placeholder]) => (
              <View key={label}>
                <Text style={styles.label}>{label}</Text>
                {field({ value, onChangeText: set, placeholder, autoCapitalize: 'none', autoCorrect: false })}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Sticky Save: the one primary action on this screen. */}
        <View style={[styles.saveBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={[styles.saveBtn, busy && styles.saveBtnBusy]}
            onPress={save}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {saving ? <ActivityIndicator color="#000000" /> : <Text style={styles.saveText}>{t('profile.save')}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const AVATAR = 96;

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: { justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
    topTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
    content: { paddingHorizontal: 16, paddingBottom: 32 },
    photoWrap: { alignItems: 'center', marginBottom: 28, gap: 10 },
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
    avatarInitial: { fontSize: 38, fontWeight: '700', color: colors.text },
    avatarBusy: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoAction: { fontSize: 14, fontWeight: '700', color: colors.text },
    group: { marginBottom: 28 },
    label: { marginTop: 12, marginBottom: 6, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    // A fill, no hairline (POSH ladder: a form field sits one step up).
    input: {
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
      backgroundColor: T.surfaceRaised,
    },
    bioInput: { minHeight: 88, textAlignVertical: 'top' },
    charCount: { marginTop: 4, fontSize: 11, color: colors.textTertiary, textAlign: 'right' },
    dialRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    dialChip: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.chip,
      backgroundColor: T.surfaceRaised,
    },
    // A chosen chip is the one pure white (POSH ladder), not a teal fill.
    dialChipActive: { backgroundColor: T.white },
    dialChipText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    dialChipTextActive: { color: T.onWhite },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
    logoPreview: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoImage: { width: '100%', height: '100%' },
    logoLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    logoActions: { flexDirection: 'row', gap: 18 },
    textAction: { fontSize: 14, fontWeight: '700', color: colors.text },
    textActionMuted: { color: colors.textTertiary },
    saveBar: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.background },
    saveBtn: {
      height: 54,
      borderRadius: radius.button,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnBusy: { opacity: 0.6 },
    saveText: { color: T.onWhite, fontSize: 16, fontWeight: '700' },
  });
