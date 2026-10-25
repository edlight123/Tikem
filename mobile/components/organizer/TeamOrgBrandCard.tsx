import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Briefcase } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveOrg } from '../../lib/activeOrg';
import { loadOrgBrand, saveActingOrgBrand } from '../../lib/api/orgSettings';
import { ProfileImageError, uploadProfileImage } from '../../lib/profileImages';
import { useImageChooser } from '../../hooks/useImageChooser';
import { useAppAlert } from '../AppAlert';
import { isDemoMode } from '../../config/firebase';
import { colors as T, radius } from '../../theme/tokens';
import SectionHeader from '../SectionHeader';
import WhitePillCTA from '../WhitePillCTA';
import FormSheet, { SheetInput, SheetLabel } from './FormSheet';
import { useOrgLabel } from './OrgSwitcher';

/**
 * The organization card for someone acting for ANOTHER person's org. An admin
 * (manage_settings) can rename it and change its logo; a manager sees it
 * read-only. The owner's own card stays on ProfileScreen, which writes their
 * profile directly; this one saves through the server (lib/api/orgSettings.ts).
 */
export default function TeamOrgBrandCard({ style }: { style?: any }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const { user } = useAuth();
  const showAlert = useAppAlert();
  const chooseImage = useImageChooser();
  const { orgId, role, can, refresh } = useActiveOrg();
  const { roleLabel } = useOrgLabel();
  const editable = can('manage_settings');

  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const brand = await loadOrgBrand(orgId);
      setName(brand.organization_name);
      setLogo(brand.organization_logo);
    } catch {
      // Keep what we have; the card still names the role.
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const fail = (e: any) => {
    const key = e instanceof ProfileImageError ? e.key : null;
    showAlert(t('common.error'), key ? t(key) : t('orgTeam.brand.saveFailed'));
  };

  const changeLogo = () => {
    if (!editable || !user?.uid) return;
    if (isDemoMode) {
      showAlert(t('common.error'), t('profile.uploads.logoDemoDisabled'));
      return;
    }
    chooseImage({
      title: t('profile.organization.logoTitle'),
      removeLabel: t('profile.organization.removeLogo'),
      hasExisting: !!logo,
      onPicked: async (asset) => {
        setUploading(true);
        try {
          // The actor's own prefix: storage.rules open profile-images/{uid}/ to them only.
          const url = await uploadProfileImage(user.uid, asset, 'logo');
          await saveActingOrgBrand({ organization_logo: url });
          setLogo(url);
        } catch (e) {
          fail(e);
        } finally {
          setUploading(false);
        }
      },
      onRemove: async () => {
        try {
          await saveActingOrgBrand({ organization_logo: '' });
          setLogo('');
        } catch (e) {
          fail(e);
        }
      },
    });
  };

  const saveName = async () => {
    const next = draft.trim();
    if (!next) return;
    setSaving(true);
    try {
      await saveActingOrgBrand({ organization_name: next });
      setName(next);
      setEditing(false);
      // The switcher shows the org's name too.
      refresh().catch(() => {});
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={style}>
      <SectionHeader title={t('profile.organization.sectionTitle')} />
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.logo}
          onPress={changeLogo}
          disabled={!editable || uploading}
          accessibilityRole={editable ? 'button' : 'image'}
          accessibilityLabel={logo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
        >
          {logo ? (
            <Image source={{ uri: logo }} style={styles.logoImage} contentFit="cover" transition={150} />
          ) : (
            <Briefcase size={22} color={colors.textSecondary} />
          )}
          {uploading ? (
            <View style={styles.busy}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.meta}
          disabled={!editable}
          onPress={() => {
            setDraft(name);
            setEditing(true);
          }}
          accessibilityRole={editable ? 'button' : 'text'}
        >
          <Text style={[styles.name, !name && styles.nameEmpty]} numberOfLines={1}>
            {name || t('orgTeam.unnamedOrg')}
          </Text>
          <Text style={styles.hint} numberOfLines={2}>
            {editable
              ? t('orgTeam.brand.hintAdmin', { role: roleLabel(role) })
              : t('orgTeam.brand.hintReadOnly', { role: roleLabel(role) })}
          </Text>
        </TouchableOpacity>
        {editable ? (
          <TouchableOpacity onPress={changeLogo} disabled={uploading} hitSlop={10} accessibilityRole="button">
            <Text style={styles.action}>
              {logo ? t('profile.organization.changeLogo') : t('profile.organization.addLogo')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FormSheet
        visible={editing}
        title={t('orgTeam.brand.renameTitle')}
        onClose={() => setEditing(false)}
        closeLabel={t('common.close')}
        busy={saving}
        footer={
          <WhitePillCTA
            label={t('orgTeam.save')}
            onPress={saveName}
            disabled={!draft.trim() || saving}
            loading={saving}
          />
        }
      >
        <SheetLabel>{t('orgTeam.brand.nameLabel')}</SheetLabel>
        <SheetInput value={draft} onChangeText={setDraft} autoFocus maxLength={100} returnKeyType="done" onSubmitEditing={saveName} />
      </FormSheet>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    card: {
      backgroundColor: T.surface,
      borderRadius: radius.lg,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    logo: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoImage: { width: '100%', height: '100%' },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    meta: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: '700', color: colors.text },
    nameEmpty: { color: colors.textSecondary, fontWeight: '600' },
    hint: { marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.textTertiary },
    action: { fontSize: 13, fontWeight: '700', color: colors.text },
  });
