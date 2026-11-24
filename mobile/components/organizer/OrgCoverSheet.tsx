/**
 * The organization page's banner: pick one of our photos (the same world
 * photos as the website), upload your own, or have none. Saves at once
 * through /api/organizer/settings/cover (lib/orgPage.ts), which checks the
 * caller is the org's owner or a team admin.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Check, Upload } from 'lucide-react-native';
import FormSheet from './FormSheet';
import WhitePillCTA from '../WhitePillCTA';
import { useAppAlert } from '../AppAlert';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme } from '../../contexts/ThemeContext';
import { colors as T, radius, spacing } from '../../theme/tokens';
import {
  COVER_TEMPLATES,
  COVER_TEMPLATE_SOURCES,
  OrgPageError,
  pickOrgPagePhotos,
  saveOrgCoverTemplate,
  uploadOrgCover,
  type CoverTemplate,
  type OrgCoverState,
} from '../../lib/orgPage';

export default function OrgCoverSheet({
  visible,
  orgId,
  current,
  onClose,
  onChanged,
}: {
  visible: boolean;
  orgId: string;
  current: OrgCoverState;
  onClose: () => void;
  onChanged: (next: OrgCoverState) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  // 4 across inside the sheet's 16pt padding, 8pt gaps.
  const tile = Math.floor((width - spacing.lg * 2 - 8 * 3) / 4);

  const fail = (e: unknown) => {
    const key = e instanceof OrgPageError ? e.key : 'orgPage.errors.saveFailed';
    showAlert(t('orgPage.errors.title'), t(key));
  };

  const pick = async (key: CoverTemplate | null) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await saveOrgCoverTemplate(orgId, key));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (busy) return;
    try {
      const [asset] = await pickOrgPagePhotos(1);
      if (!asset) return;
      setBusy(true);
      onChanged(await uploadOrgCover(orgId, asset));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const preview = current.coverTemplate
    ? COVER_TEMPLATE_SOURCES[current.coverTemplate]
    : current.coverImageUrl
      ? { uri: current.coverImageUrl }
      : null;

  return (
    <FormSheet
      visible={visible}
      title={t('orgPage.bannerTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      busy={busy}
      footer={
        <>
          <WhitePillCTA
            size="sm"
            label={t('orgPage.uploadBanner')}
            icon={<Upload size={16} color={T.onWhite} />}
            onPress={upload}
            disabled={busy}
          />
          {preview ? (
            <TouchableOpacity onPress={() => pick(null)} disabled={busy} style={styles.removeRow} accessibilityRole="button">
              <Text style={styles.removeText}>{t('orgPage.removeBanner')}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      }
    >
      <View style={styles.preview}>
        {preview ? (
          <Image source={preview} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <Text style={styles.previewEmpty}>{t('orgPage.noBanner')}</Text>
        )}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={T.white} />
          </View>
        ) : null}
      </View>

      <View style={styles.grid}>
        {COVER_TEMPLATES.map((key, i) => {
          const selected = current.coverTemplate === key;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.85}
              onPress={() => pick(key)}
              disabled={busy}
              style={[styles.tile, { width: tile, height: tile }]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('orgPage.templateLabel', { n: i + 1 })}
            >
              <Image source={COVER_TEMPLATE_SOURCES[key]} style={StyleSheet.absoluteFill} contentFit="cover" />
              {selected ? (
                <View style={styles.selected}>
                  <Check size={18} color={T.onWhite} strokeWidth={2.6} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </FormSheet>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    preview: {
      marginTop: 12,
      aspectRatio: 3,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewEmpty: { fontSize: 13, color: colors.textSecondary },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    tile: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: T.surfaceRaised },
    selected: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeRow: { alignSelf: 'center', paddingVertical: 8 },
    removeText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  });
